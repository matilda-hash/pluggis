"""
Google Calendar integration via OAuth 2.0.
Tokens are stored in the OAuthToken DB table (not files).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy.orm import Session

from ..models import OAuthToken

SCOPES = [
    "https://www.googleapis.com/auth/calendar",          # full access: read + write + manage calendars
    "https://www.googleapis.com/auth/calendar.events",   # kept for backwards compat with old tokens
]

# Keywords for classifying calendar events (Swedish + English)
_LECTURE_KEYWORDS = ["föreläsning", "lecture", "lektion", "seminarium", "seminar", "kurs", "undervisning"]
_TRAINING_KEYWORDS = ["träning", "gym", "training", "workout", "löpning", "simning", "yoga", "idrott"]
_VFU_KEYWORDS = ["vfu", "klinisk praktik", "praktik", "auskultation", "placering"]
_WORK_KEYWORDS = ["jobb", "arbete", "arbetsdag", "kontor", "skift", "tjänst", "work", "office", "shift", "job"]


class GoogleCalendarService:
    def __init__(self, db: Session, user_id: int = 1):
        self.db = db
        self.user_id = user_id
        self._credentials = None

    def is_authenticated(self) -> bool:
        token = self._load_token()
        return token is not None and bool(token.access_token)

    def needs_reauth(self) -> bool:
        """True if the stored token is missing the full 'calendar' scope (can't create calendars)."""
        token = self._load_token()
        if not token:
            return False
        scopes = token.scopes or []
        return not any(
            isinstance(s, str) and "googleapis.com/auth/calendar" in s and "readonly" not in s and "events" not in s
            for s in scopes
        )

    def get_email(self) -> Optional[str]:
        """Return the authenticated user's email if available."""
        token = self._load_token()
        if token and token.scopes:
            # Email is stored in scopes JSON as a special key if we saved it
            scopes = token.scopes if isinstance(token.scopes, list) else []
            for item in scopes:
                if isinstance(item, str) and item.startswith("email:"):
                    return item[6:]
        return None

    def get_auth_url(self, client_id: str, client_secret: str, redirect_uri: str) -> str:
        """Build Google OAuth consent URL."""
        try:
            from google_auth_oauthlib.flow import Flow
        except ImportError:
            raise RuntimeError("google-auth-oauthlib not installed. Run: pip install google-auth-oauthlib")

        flow = Flow.from_client_config(
            {
                "web": {
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "redirect_uris": [redirect_uri],
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                }
            },
            scopes=SCOPES,
            redirect_uri=redirect_uri,
        )
        auth_url, _ = flow.authorization_url(
            access_type="offline",
            include_granted_scopes="true",
            prompt="consent",
        )
        # Store client credentials for later exchange
        self._save_client_creds(client_id, client_secret, redirect_uri)
        return auth_url

    def exchange_code(self, code: str, client_id: str, client_secret: str, redirect_uri: str) -> bool:
        """Complete OAuth flow, save tokens to DB. Returns True on success."""
        try:
            from google_auth_oauthlib.flow import Flow
        except ImportError:
            return False

        flow = Flow.from_client_config(
            {
                "web": {
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "redirect_uris": [redirect_uri],
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                }
            },
            scopes=SCOPES,
            redirect_uri=redirect_uri,
        )
        try:
            flow.fetch_token(code=code)
            creds = flow.credentials
            self._save_credentials(creds, client_id, client_secret)
            return True
        except Exception:
            return False

    def revoke(self) -> bool:
        """Delete stored token."""
        token = self._load_token()
        if token:
            self.db.delete(token)
            self.db.commit()
        return True

    def get_events(self, date_from: datetime, date_to: datetime) -> List[dict]:
        """Fetch events only from the 'primary' (main) calendar.
        Pluggis writes to its own separate calendar and never reads it back."""
        creds = self._build_credentials()
        if not creds:
            return []
        try:
            from googleapiclient.discovery import build
            service = build("calendar", "v3", credentials=creds, cache_discovery=False)

            result = (
                service.events()
                .list(
                    calendarId="primary",
                    timeMin=date_from.isoformat() + "Z",
                    timeMax=date_to.isoformat() + "Z",
                    singleEvents=True,
                    orderBy="startTime",
                    maxResults=250,
                )
                .execute()
            )
            events = []
            for event in result.get("items", []):
                event["_cal_name"] = "main"
                events.append(event)
            return events
        except Exception:
            return []

    def classify_event(self, event: dict) -> str:
        """Classify a Google Calendar event into a study-relevant type.
        Uses event title, description, AND source calendar name."""
        title = event.get("summary", "").lower()
        description = event.get("description", "").lower()
        cal_name = event.get("_cal_name", "").lower()
        combined = f"{title} {description} {cal_name}"

        for kw in _VFU_KEYWORDS:
            if kw in combined:
                return "vfu"
        for kw in _LECTURE_KEYWORDS:
            if kw in combined:
                return "lecture"
        for kw in _TRAINING_KEYWORDS:
            if kw in combined:
                return "training"
        for kw in _WORK_KEYWORDS:
            if kw in combined:
                return "work"
        return "other"

    def is_in_person(self, event: dict) -> bool:
        """Detect if an event is in-person (has a physical location, not Zoom/Teams)."""
        location = event.get("location", "").lower()
        description = event.get("description", "").lower()
        online_keywords = ["zoom", "teams", "meet.google", "webex", "online", "digitalt", "distans"]
        if location:
            for kw in online_keywords:
                if kw in location or kw in description:
                    return False
            return True
        return False

    def get_or_create_pluggis_calendar(self) -> str:
        """Find or create the 'Pluggis' calendar. Returns its calendar ID.
        The ID is cached in the token scopes to avoid repeated API calls."""
        # Check cache first
        token = self._load_token()
        if token:
            for item in (token.scopes or []):
                if isinstance(item, str) and item.startswith("pluggis_cal_id:"):
                    return item[15:]

        creds = self._build_credentials()
        if not creds:
            return "primary"
        try:
            from googleapiclient.discovery import build
            service = build("calendar", "v3", credentials=creds, cache_discovery=False)

            # Look for existing Pluggis calendar
            cal_list = service.calendarList().list().execute()
            for cal in cal_list.get("items", []):
                if cal.get("summary", "").lower() == "pluggis":
                    cal_id = cal["id"]
                    self._cache_pluggis_cal_id(cal_id)
                    return cal_id

            # Create it (requires full 'calendar' scope)
            new_cal = service.calendars().insert(body={
                "summary": "Pluggis",
                "description": "Studieblock genererade av Pluggis-appen",
                "timeZone": "Europe/Stockholm",
            }).execute()
            cal_id = new_cal["id"]
            self._cache_pluggis_cal_id(cal_id)
            return cal_id
        except Exception:
            return "primary"

    def _cache_pluggis_cal_id(self, cal_id: str) -> None:
        """Store the Pluggis calendar ID in the token scopes JSON for reuse."""
        token = self._load_token()
        if not token:
            return
        scopes = list(token.scopes or [])
        # Remove any old cached ID
        scopes = [s for s in scopes if not (isinstance(s, str) and s.startswith("pluggis_cal_id:"))]
        scopes.append(f"pluggis_cal_id:{cal_id}")
        token.scopes = scopes
        self.db.commit()

    def create_event(
        self,
        title: str,
        start: datetime,
        end: datetime,
        description: str = "",
        color_id: Optional[str] = None,
        calendar_id: Optional[str] = None,
    ) -> Optional[str]:
        """Create a Google Calendar event. Returns the event ID or None on failure."""
        creds = self._build_credentials()
        if not creds:
            return None
        if calendar_id is None:
            calendar_id = self.get_or_create_pluggis_calendar()
        try:
            from googleapiclient.discovery import build
            service = build("calendar", "v3", credentials=creds, cache_discovery=False)
            body = {
                "summary": title,
                "description": description,
                "start": {"dateTime": start.isoformat(), "timeZone": "Europe/Stockholm"},
                "end": {"dateTime": end.isoformat(), "timeZone": "Europe/Stockholm"},
            }
            if color_id:
                body["colorId"] = color_id
            event = service.events().insert(calendarId=calendar_id, body=body).execute()
            return event.get("id")
        except Exception:
            # Fall back to primary if target calendar failed
            if calendar_id != "primary":
                try:
                    from googleapiclient.discovery import build
                    service = build("calendar", "v3", credentials=creds, cache_discovery=False)
                    event = service.events().insert(calendarId="primary", body=body).execute()
                    return event.get("id")
                except Exception:
                    pass
            return None

    def update_event(
        self,
        google_event_id: str,
        title: str,
        start: datetime,
        end: datetime,
        description: str = "",
    ) -> bool:
        """Update an existing Google Calendar event. Returns True on success."""
        creds = self._build_credentials()
        if not creds:
            return False
        cal_id = self.get_or_create_pluggis_calendar()
        try:
            from googleapiclient.discovery import build
            service = build("calendar", "v3", credentials=creds, cache_discovery=False)
            body = {
                "summary": title,
                "description": description,
                "start": {"dateTime": start.isoformat(), "timeZone": "Europe/Stockholm"},
                "end": {"dateTime": end.isoformat(), "timeZone": "Europe/Stockholm"},
            }
            service.events().update(calendarId=cal_id, eventId=google_event_id, body=body).execute()
            return True
        except Exception:
            try:
                service.events().update(calendarId="primary", eventId=google_event_id, body=body).execute()
                return True
            except Exception:
                return False

    def delete_event(self, google_event_id: str) -> bool:
        creds = self._build_credentials()
        if not creds:
            return False
        cal_id = self.get_or_create_pluggis_calendar()
        try:
            from googleapiclient.discovery import build
            service = build("calendar", "v3", credentials=creds, cache_discovery=False)
            service.events().delete(calendarId=cal_id, eventId=google_event_id).execute()
            return True
        except Exception:
            try:
                service.events().delete(calendarId="primary", eventId=google_event_id).execute()
                return True
            except Exception:
                return False

    # ── Private helpers ───────────────────────────────────────────────────────

    def _load_token(self) -> Optional[OAuthToken]:
        return (
            self.db.query(OAuthToken)
            .filter(OAuthToken.user_id == self.user_id, OAuthToken.provider == "google")
            .first()
        )

    def _build_credentials(self):
        """Build google.oauth2.credentials.Credentials from stored token."""
        token = self._load_token()
        if not token:
            return None
        try:
            from google.oauth2.credentials import Credentials
            from google.auth.transport.requests import Request

            # Extract client creds stored in scopes JSON
            scopes_data = token.scopes if isinstance(token.scopes, list) else []
            client_id = None
            client_secret = None
            for item in scopes_data:
                if isinstance(item, str) and item.startswith("client_id:"):
                    client_id = item[10:]
                elif isinstance(item, str) and item.startswith("client_secret:"):
                    client_secret = item[14:]

            expiry = token.token_expiry
            if expiry and expiry.tzinfo is None:
                expiry = expiry.replace(tzinfo=timezone.utc)

            creds = Credentials(
                token=token.access_token,
                refresh_token=token.refresh_token,
                token_uri="https://oauth2.googleapis.com/token",
                client_id=client_id,
                client_secret=client_secret,
                scopes=SCOPES,
                expiry=expiry,
            )

            # Refresh if expired
            if creds.expired and creds.refresh_token:
                creds.refresh(Request())
                # Persist refreshed token
                token.access_token = creds.token
                if creds.expiry:
                    token.token_expiry = creds.expiry.replace(tzinfo=None)
                self.db.commit()

            return creds
        except Exception:
            return None

    def _save_credentials(self, creds, client_id: str, client_secret: str):
        """Persist credentials to OAuthToken table."""
        token = self._load_token()
        scopes_data = SCOPES + [
            f"client_id:{client_id}",
            f"client_secret:{client_secret}",
        ]

        # Fetch user email via primary calendar ID (no extra OAuth scope needed)
        try:
            from googleapiclient.discovery import build
            svc = build("calendar", "v3", credentials=creds, cache_discovery=False)
            primary = svc.calendars().get(calendarId="primary").execute()
            email = primary.get("id", "")
            if email and "@" in email:
                scopes_data.append(f"email:{email}")
        except Exception:
            pass

        expiry = creds.expiry.replace(tzinfo=None) if creds.expiry else None
        if token:
            token.access_token = creds.token or ""
            token.refresh_token = creds.refresh_token
            token.token_expiry = expiry
            token.scopes = scopes_data
        else:
            token = OAuthToken(
                user_id=self.user_id,
                provider="google",
                access_token=creds.token or "",
                refresh_token=creds.refresh_token,
                token_expiry=expiry,
                scopes=scopes_data,
            )
            self.db.add(token)
        self.db.commit()

    def _save_client_creds(self, client_id: str, client_secret: str, redirect_uri: str):
        """Save client credentials to DB so the GET callback can retrieve them."""
        token = self._load_token()
        scopes_data = [
            f"client_id:{client_id}",
            f"client_secret:{client_secret}",
            f"redirect_uri:{redirect_uri}",
        ]
        if token:
            token.scopes = scopes_data
        else:
            token = OAuthToken(
                user_id=self.user_id,
                provider="google",
                access_token="",
                scopes=scopes_data,
            )
            self.db.add(token)
        self.db.commit()

    def get_saved_client_creds(self):
        """Retrieve client credentials saved during auth start."""
        token = self._load_token()
        if not token:
            return None, None, None
        scopes_data = token.scopes if isinstance(token.scopes, list) else []
        client_id = client_secret = redirect_uri = None
        for item in scopes_data:
            if isinstance(item, str) and item.startswith("client_id:"):
                client_id = item[10:]
            elif isinstance(item, str) and item.startswith("client_secret:"):
                client_secret = item[14:]
            elif isinstance(item, str) and item.startswith("redirect_uri:"):
                redirect_uri = item[13:]
        return client_id, client_secret, redirect_uri
