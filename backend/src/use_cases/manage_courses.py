from datetime import datetime
from typing import List, Optional
from src.domain.entities import CourseEntity, ProjectEntity
from src.use_cases.interfaces import ICourseRepository


class CreateCourseUseCase:
    def __init__(self, course_repo: ICourseRepository):
        self.course_repo = course_repo

    def execute(
        self,
        name: str,
        user_id: int,
        description: str = None,
        tech_requirements: Optional[str] = None,
        deadline: Optional[datetime] = None,
    ) -> CourseEntity:
        return self.course_repo.create(
            name=name,
            description=description,
            user_id=user_id,
            tech_requirements=tech_requirements,
            deadline=deadline,
        )


class UpdateCourseUseCase:
    """Edits course metadata. Only the fields supplied by the caller are written,
    so an instructor can fill in tech requirements or a deadline later, or clear
    one without touching the rest of the course."""

    EDITABLE_FIELDS = {"name", "description", "tech_requirements", "deadline"}

    def __init__(self, course_repo: ICourseRepository):
        self.course_repo = course_repo

    def execute(self, course_id: int, user_id: int, fields: dict) -> CourseEntity:
        if not self.course_repo.get_by_id(course_id, user_id=user_id):
            raise ValueError(f"Course with ID {course_id} not found.")

        changes = {k: v for k, v in fields.items() if k in self.EDITABLE_FIELDS}

        if "name" in changes:
            name = (changes["name"] or "").strip()
            if not name:
                raise ValueError("Course name cannot be empty.")
            changes["name"] = name

        if not changes:
            return self.course_repo.get_by_id(course_id, user_id=user_id)

        course = self.course_repo.update(course_id, user_id=user_id, fields=changes)
        if not course:
            raise ValueError(f"Course with ID {course_id} not found.")
        return course


class GetAllCoursesUseCase:
    def __init__(self, course_repo: ICourseRepository):
        self.course_repo = course_repo

    def execute(self, user_id: int) -> List[CourseEntity]:
        return self.course_repo.get_all(user_id=user_id)


class GetCourseByIdUseCase:
    def __init__(self, course_repo: ICourseRepository):
        self.course_repo = course_repo

    def execute(self, course_id: int, user_id: int) -> CourseEntity:
        course = self.course_repo.get_by_id(course_id, user_id=user_id)
        if not course:
            raise ValueError(f"Course with ID {course_id} not found.")
        return course


class DeleteCourseUseCase:
    def __init__(self, course_repo: ICourseRepository):
        self.course_repo = course_repo

    def execute(self, course_id: int, user_id: int) -> None:
        success = self.course_repo.delete(course_id, user_id=user_id)
        if not success:
            raise ValueError(f"Course with ID {course_id} not found.")


class GetCourseProjectsUseCase:
    def __init__(self, course_repo: ICourseRepository):
        self.course_repo = course_repo

    def execute(self, course_id: int, user_id: int) -> List[ProjectEntity]:
        course = self.course_repo.get_by_id(course_id, user_id=user_id)
        if not course:
            raise ValueError(f"Course with ID {course_id} not found.")
        return self.course_repo.get_projects(course_id, user_id=user_id)
