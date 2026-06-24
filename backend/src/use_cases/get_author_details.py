from typing import List
from src.domain.entities import AuthorEntity
from src.use_cases.interfaces import IAuthorRepository

class GetAllAuthorsUseCase:
    def __init__(self, author_repo: IAuthorRepository):
        self.author_repo = author_repo

    def execute(self) -> List[AuthorEntity]:
        return self.author_repo.get_all()

class GetAuthorByIdUseCase:
    def __init__(self, author_repo: IAuthorRepository):
        self.author_repo = author_repo

    def execute(self, author_id: int) -> AuthorEntity:
        author = self.author_repo.get_by_id(author_id)
        if not author:
            raise ValueError(f"Author with ID {author_id} not found.")
        return author
