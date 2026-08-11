"""
AST Similarity API Router
=========================
FastAPI endpoints for analyzing code similarity between student projects
using the Winnowing algorithm.
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from src.infrastructure.database.session import get_db
from src.use_cases.detect_similarity import (
    analyze_course_similarity,
    get_course_similarity_reports,
    get_course_comparison_coverage,
)
from src.infrastructure.auth.dependencies import get_current_user
from src.infrastructure.database.models import UserModel, CourseModel, SimilarityReportModel
from src.infrastructure.database.repositories import CourseRepository

similarity_router = APIRouter(prefix="/api/v1", tags=["Similarity Detection"])


class SimilarityAnalyzeRequest(BaseModel):
    k: int = Field(default=5, description="K-gram token size (default: 5)")
    w: int = Field(default=4, description="Winnowing window size (default: 4)")
    similarity_threshold: float = Field(
        default=40.0, description="Flagging similarity percentage threshold (default: 40.0%)"
    )
    allowed_extensions: Optional[List[str]] = Field(
        default=[".py", ".js", ".ts", ".jsx", ".tsx"],
        description="Source file extensions to inspect",
    )


@similarity_router.post("/courses/{course_id}/similarity/analyze")
def run_similarity_analysis(
    course_id: int,
    req: SimilarityAnalyzeRequest = SimilarityAnalyzeRequest(),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """
    Triggers AST-based Winnowing similarity analysis across all projects in a course.
    Computes AST structure tokens, hashes k-grams, applies Winnowing, and performs
    inverted index pairwise comparisons.
    """
    course_repo = CourseRepository(db)
    course = course_repo.get_by_id(course_id, user_id=current_user.id)
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Course with ID {course_id} not found."
        )
    try:
        result = analyze_course_similarity(
            db=db,
            course_id=course_id,
            k=req.k,
            w=req.w,
            similarity_threshold=req.similarity_threshold,
            allowed_extensions=req.allowed_extensions,
        )
        return result
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Similarity analysis failed: {str(e)}",
        )


@similarity_router.post("/courses/{course_id}/similarity/rescan")
def force_full_rescan(
    course_id: int,
    req: SimilarityAnalyzeRequest = SimilarityAnalyzeRequest(),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """
    Admin Force Full Rescan Action.
    Forces full-corpus re-comparison for all projects in a course, updates comparison coverage,
    and returns updated reports and multi-project clusters.
    """
    course_repo = CourseRepository(db)
    course = course_repo.get_by_id(course_id, user_id=current_user.id)
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Course with ID {course_id} not found."
        )
    try:
        result = analyze_course_similarity(
            db=db,
            course_id=course_id,
            k=req.k,
            w=req.w,
            similarity_threshold=req.similarity_threshold,
            allowed_extensions=req.allowed_extensions,
        )
        coverage = get_course_comparison_coverage(db=db, course_id=course_id)
        result["coverage"] = coverage
        return result
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Force full rescan failed: {str(e)}",
        )


@similarity_router.get("/courses/{course_id}/similarity/coverage")
def get_similarity_coverage(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """Retrieves pairwise comparison coverage tracking metrics for administrative visibility."""
    course_repo = CourseRepository(db)
    course = course_repo.get_by_id(course_id, user_id=current_user.id)
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Course with ID {course_id} not found."
        )
    try:
        return get_course_comparison_coverage(db=db, course_id=course_id)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch coverage metrics: {str(e)}",
        )


@similarity_router.get("/courses/{course_id}/similarity/reports")
def list_similarity_reports(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """Retrieves stored pairwise similarity reports for a course."""
    course_repo = CourseRepository(db)
    course = course_repo.get_by_id(course_id, user_id=current_user.id)
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Course with ID {course_id} not found."
        )
    try:
        data = get_course_similarity_reports(db=db, course_id=course_id)
        if isinstance(data, dict):
            return data
        return {"course_id": course_id, "total_reports": len(data), "reports": data, "clusters": []}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch similarity reports: {str(e)}",
        )


class ReportStatusUpdateRequest(BaseModel):
    status: str = Field(..., description="New report status: 'Needs Review', 'Resolved', 'Dismissed', or 'Confirmed'")


@similarity_router.patch("/similarity/reports/{report_id}/status")
def update_similarity_report_status(
    report_id: int,
    req: ReportStatusUpdateRequest,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """Updates the review status of a similarity report in the database."""
    report = (
        db.query(SimilarityReportModel)
        .join(CourseModel, SimilarityReportModel.course_id == CourseModel.id)
        .filter(SimilarityReportModel.id == report_id, CourseModel.user_id == current_user.id)
        .first()
    )
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")

    report.status = req.status
    db.commit()
    return {"status": "success", "report_id": report_id, "new_status": req.status}
