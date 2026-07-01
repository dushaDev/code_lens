from typing import List
from src.domain.entities import CourseEntity, ProjectEntity
from src.use_cases.interfaces import ICourseRepository


class CreateCourseUseCase:
    def __init__(self, course_repo: ICourseRepository):
        self.course_repo = course_repo

    def execute(self, name: str, description: str = None) -> CourseEntity:
        return self.course_repo.create(name=name, description=description)


class GetAllCoursesUseCase:
    def __init__(self, course_repo: ICourseRepository):
        self.course_repo = course_repo

    def execute(self) -> List[CourseEntity]:
        return self.course_repo.get_all()


class GetCourseByIdUseCase:
    def __init__(self, course_repo: ICourseRepository):
        self.course_repo = course_repo

    def execute(self, course_id: int) -> CourseEntity:
        course = self.course_repo.get_by_id(course_id)
        if not course:
            raise ValueError(f"Course with ID {course_id} not found.")
        return course


class DeleteCourseUseCase:
    def __init__(self, course_repo: ICourseRepository):
        self.course_repo = course_repo

    def execute(self, course_id: int) -> None:
        success = self.course_repo.delete(course_id)
        if not success:
            raise ValueError(f"Course with ID {course_id} not found.")


class GetCourseProjectsUseCase:
    def __init__(self, course_repo: ICourseRepository):
        self.course_repo = course_repo

    def execute(self, course_id: int) -> List[ProjectEntity]:
        course = self.course_repo.get_by_id(course_id)
        if not course:
            raise ValueError(f"Course with ID {course_id} not found.")
        return self.course_repo.get_projects(course_id)
