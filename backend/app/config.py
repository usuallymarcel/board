import os
import secrets
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=False, extra='ignore')

    data_dir: Path = Path('/data')
    frontend_dist: Path = Path('/app/frontend/dist')

    users_api_url: str = 'http://users-api:8000'
    allow_signup: bool = True
    # closed: 503 on private data while users-api is down. global: a shared workspace instead.
    auth_fail_mode: Literal['global', 'closed'] = 'closed'
    # Comma separated names allowed to moderate the forum.
    admin_users: str = ''
    max_upload_mb: int = 500
    user_quota_mb: int = 10240
    # Extra browser origins allowed past the CSRF check (comma separated), for the Vite dev server.
    csrf_trusted_origins: str = ''

    trash_days: int = 30
    maintenance_interval: float = 3600.0

    health_ttl: float = 15.0
    token_ttl: float = 60.0
    # Budget for a health probe or token check; requests never wait longer than this.
    auth_timeout: float = 2.0
    # Password hashing makes login slower than the checks above.
    login_timeout: float = 15.0

    login_rate_limit: int = 10
    login_rate_window: float = 60.0
    public_rate_limit: int = 30
    forum_rate_limit: int = 20

    @property
    def users_api_base(self) -> str:
        return self.users_api_url.strip().rstrip('/')

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def quota_bytes(self) -> int:
        return self.user_quota_mb * 1024 * 1024

    @property
    def admin_names(self) -> set[str]:
        return {name.strip().lower() for name in self.admin_users.split(',') if name.strip()}

    @property
    def trusted_origins(self) -> set[str]:
        return {o.strip().rstrip('/') for o in self.csrf_trusted_origins.split(',') if o.strip()}

    @property
    def database_url(self) -> str:
        return f'sqlite:///{self.data_dir / "board.sqlite3"}'

    @property
    def file_dir(self) -> Path:
        return self.data_dir / 'files'

    @property
    def tmp_dir(self) -> Path:
        return self.data_dir / 'tmp'

    def ensure_dirs(self) -> None:
        for path in (self.data_dir, self.file_dir, self.tmp_dir):
            path.mkdir(parents=True, exist_ok=True)

    def signing_key(self) -> bytes:
        """Signs short-lived share grants. Generated once and kept on the data volume."""
        path = self.data_dir / 'signing.key'
        try:
            return path.read_bytes()
        except FileNotFoundError:
            pass
        key = secrets.token_bytes(32)
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'wb') as handle:
            handle.write(key)
        return key
