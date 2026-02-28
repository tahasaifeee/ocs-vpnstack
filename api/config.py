from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "postgresql+asyncpg://vpnuser:secret@postgres:5432/vpndb"
    redis_url: str = "redis://redis:6379"
    secret_key: str = "change-me-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 30

    ocserv_config_dir: str = "/etc/ocserv"

    @property
    def ocpasswd_file(self) -> str:
        return f"{self.ocserv_config_dir}/ocpasswd"

    @property
    def oath_file(self) -> str:
        return f"{self.ocserv_config_dir}/users.oath"

    @property
    def user_routes_dir(self) -> str:
        return f"{self.ocserv_config_dir}/user-routes"


settings = Settings()
