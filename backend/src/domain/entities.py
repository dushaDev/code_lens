from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional

@dataclass
class FingerprintEntity:
    hash_value: int
    position: int
    file_path: str
    line_number: int
    raw_ident: Optional[str] = None

@dataclass
class FileChangeEntity:
    filename: str
    status: str
    lines_added: int
    lines_removed: int
    raw_diff: Optional[str] = None
    commit_hash: Optional[str] = None
    id: Optional[int] = None
    complexity_score: Optional[int] = None
    function_count: Optional[int] = None
    ast_fingerprint: Optional[str] = None
    blame_snapshot: Optional[str] = None

@dataclass
class BranchEntity:
    project_id: int
    name: str
    short_name: str
    id: Optional[int] = None

@dataclass
class CommitEntity:
    hash: str
    project_id: int
    author_id: int
    timestamp: datetime
    message: str
    insertions: int
    deletions: int
    is_squash_suspected: bool = False
    branches: List[BranchEntity] = field(default_factory=list)
    project: Optional["ProjectEntity"] = None
    file_changes: List[FileChangeEntity] = field(default_factory=list)

@dataclass
class AuthorEntity:
    name: str
    email: str
    id: Optional[int] = None
    canonical_author_id: Optional[int] = None
    commits: List[CommitEntity] = field(default_factory=list)
    aliases: List["AuthorEntity"] = field(default_factory=list)

@dataclass
class ProjectEntity:
    name: str
    git_url: str
    local_saved_path: str
    group_no: str
    store_local_copy: bool = False
    is_local_copy_stored: bool = False
    course_id: Optional[int] = None
    description: Optional[str] = None
    created_at: Optional[datetime] = None
    sampling_mode: Optional[str] = "sample"
    id: Optional[int] = None
    tech_stack: List[str] = field(default_factory=list)
    commits: List[CommitEntity] = field(default_factory=list)

@dataclass
class CourseEntity:
    name: str
    user_id: int = 0
    description: Optional[str] = None
    tech_requirements: Optional[str] = None
    deadline: Optional[datetime] = None
    default_sampling_mode: Optional[str] = "sample"
    created_at: Optional[datetime] = None
    id: Optional[int] = None
    projects: List[ProjectEntity] = field(default_factory=list)

@dataclass
class StudentReportEntity:
    student_name: str = "Unknown Contributor"
    commits_summary: Optional[str] = "N/A"
    substance_breakdown: Optional[str] = "N/A"
    pacing_and_deadlines: Optional[str] = "N/A"
    quality_and_integrity_signals: Optional[str] = "N/A"
    contribution_areas: Optional[str] = "N/A"
    verdict: Optional[str] = "No verdict provided."

@dataclass
class IdentityIssueEntity:
    kind: str = "split_identity"
    confidence: str = "MEDIUM"
    members: List[str] = field(default_factory=list)
    evidence: List[str] = field(default_factory=list)
    recommended_action: str = ""
    author_ids: Optional[List[int]] = field(default_factory=list)
    matched_tokens: Optional[List[str]] = field(default_factory=list)

@dataclass
class CloudReportEntity:
    executive_summary: Optional[str] = "Executive summary not provided."
    work_distribution_and_fairness: Optional[str] = "Work distribution details not provided."
    student_evaluations: Optional[List[StudentReportEntity]] = field(default_factory=list)
    academic_integrity_anomalies: Optional[str] = "No anomalies detailed."
    contributor_authenticity: Optional[str] = None
    suspected_identity_issues: Optional[List[IdentityIssueEntity]] = None
    is_solo_project: Optional[bool] = None
    overall_project_risk_score: Optional[str] = "5/10 (Moderate)"
    actionable_recommendations: Optional[List[str]] = field(default_factory=list)
    generation_provider: Optional[str] = None
    generation_model: Optional[str] = None

    def __post_init__(self):
        if self.student_evaluations:
            self.student_evaluations = [
                StudentReportEntity(**s) if isinstance(s, dict) else s
                for s in self.student_evaluations
            ]
        if self.suspected_identity_issues:
            self.suspected_identity_issues = [
                IdentityIssueEntity(**i) if isinstance(i, dict) else i
                for i in self.suspected_identity_issues
            ]

    @classmethod
    def from_dict(cls, data: dict) -> "CloudReportEntity":
        if not isinstance(data, dict):
            return cls()
        evals_raw = data.get("student_evaluations") or []
        student_evals = []
        for s in evals_raw:
            if isinstance(s, dict):
                student_evals.append(StudentReportEntity(
                    student_name=s.get("student_name", "Unknown Contributor"),
                    commits_summary=s.get("commits_summary", "N/A"),
                    substance_breakdown=s.get("substance_breakdown", "N/A"),
                    pacing_and_deadlines=s.get("pacing_and_deadlines", "N/A"),
                    quality_and_integrity_signals=s.get("quality_and_integrity_signals", "N/A"),
                    contribution_areas=s.get("contribution_areas", "N/A"),
                    verdict=s.get("verdict", "No verdict provided.")
                ))
            elif isinstance(s, StudentReportEntity):
                student_evals.append(s)

        issues_raw = data.get("suspected_identity_issues")
        identity_issues = None
        if issues_raw is not None:
            identity_issues = []
            for i in issues_raw:
                if isinstance(i, dict):
                    identity_issues.append(IdentityIssueEntity(
                        kind=i.get("kind", "split_identity"),
                        confidence=i.get("confidence", "MEDIUM"),
                        members=i.get("members") or [],
                        evidence=i.get("evidence") or [],
                        recommended_action=i.get("recommended_action", ""),
                        author_ids=i.get("author_ids") or [],
                        matched_tokens=i.get("matched_tokens") or []
                    ))
                elif isinstance(i, IdentityIssueEntity):
                    identity_issues.append(i)

        return cls(
            executive_summary=data.get("executive_summary", "Executive summary not provided."),
            work_distribution_and_fairness=data.get("work_distribution_and_fairness", "Work distribution details not provided."),
            student_evaluations=student_evals,
            academic_integrity_anomalies=data.get("academic_integrity_anomalies", "No anomalies detailed."),
            contributor_authenticity=data.get("contributor_authenticity"),
            suspected_identity_issues=identity_issues,
            is_solo_project=data.get("is_solo_project"),
            overall_project_risk_score=data.get("overall_project_risk_score", "5/10 (Moderate)"),
            actionable_recommendations=data.get("actionable_recommendations") or [],
            generation_provider=data.get("generation_provider"),
            generation_model=data.get("generation_model")
        )

    def model_dump_json(self) -> str:
        import json
        from dataclasses import asdict
        return json.dumps(asdict(self))

    def model_dump(self) -> dict:
        from dataclasses import asdict
        return asdict(self)
