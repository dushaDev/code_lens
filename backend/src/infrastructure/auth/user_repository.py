from typing import List, Optional

from sqlalchemy.orm import Session

from src.infrastructure.database.models import UserModel
from src.infrastructure.auth.hashing import hash_password


class UserRepository:
    """CRUD operations for the users table."""

    def __init__(self, db: Session):
        self.db = db

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    def get_by_id(self, user_id: int) -> Optional[UserModel]:
        return self.db.query(UserModel).filter(UserModel.id == user_id).first()

    def get_by_email(self, email: str) -> Optional[UserModel]:
        return self.db.query(UserModel).filter(UserModel.email == email).first()

    def get_by_username(self, username: str) -> Optional[UserModel]:
        return self.db.query(UserModel).filter(UserModel.username == username).first()

    def get_all(self) -> List[UserModel]:
        return self.db.query(UserModel).all()

    # ------------------------------------------------------------------
    # Create
    # ------------------------------------------------------------------

    def create(self, username: str, email: str, password: str) -> UserModel:
        """Create a new user with a bcrypt-hashed password."""
        user = UserModel(
            username=username,
            email=email,
            hashed_password=hash_password(password),
        )
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    # ------------------------------------------------------------------
    # Update
    # ------------------------------------------------------------------

    def update(
        self,
        user_id: int,
        username: Optional[str] = None,
        email: Optional[str] = None,
        password: Optional[str] = None,
        is_active: Optional[bool] = None,
        github_username: Optional[str] = None,
        is_dark_mode: Optional[bool] = None,
    ) -> Optional[UserModel]:
        """Partial update — only fields that are not None are changed."""
        user = self.get_by_id(user_id)
        if not user:
            return None
        if username is not None:
            user.username = username
        if email is not None:
            user.email = email
        if password is not None:
            user.hashed_password = hash_password(password)
        if is_active is not None:
            user.is_active = is_active
        if github_username is not None:
            # Clean empty strings to None/null in DB
            user.github_username = github_username if github_username.strip() != "" else None
        if is_dark_mode is not None:
            user.is_dark_mode = is_dark_mode
        self.db.commit()
        self.db.refresh(user)
        return user

    # ------------------------------------------------------------------
    # Delete
    # ------------------------------------------------------------------

    def delete(self, user_id: int) -> bool:
        user = self.get_by_id(user_id)
        if not user:
            return False
        self.db.delete(user)
        self.db.commit()
        return True
