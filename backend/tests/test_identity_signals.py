import pytest
from src.domain.identity_signals import (
    normalize_name_string,
    normalize_name_tokens,
    email_local,
    calculate_jaccard_similarity,
    analyze_identity_signals,
)


def test_normalize_name_string():
    assert normalize_name_string("Dúshán Mádúshánká") == "dushan madushanka"
    assert normalize_name_string("John Doe 123!") == "john doe"
    assert normalize_name_string("  alice_bob-charlie  ") == "alice bob charlie"
    assert normalize_name_string("") == ""


def test_normalize_name_tokens():
    tokens = normalize_name_tokens("Dushan Madushanka")
    assert tokens == {"dushan", "madushanka"}

    tokens_accents = normalize_name_tokens("José Müller")
    assert tokens_accents == {"jose", "muller"}


def test_email_local():
    # Standard email
    local, gh = email_local("dushan@gmail.com")
    assert local == "dushan"
    assert gh is None

    # GitHub noreply with ID
    local, gh = email_local("12345+dushan6693@users.noreply.github.com")
    assert local == "dushan6693"
    assert gh == "dushan6693"

    # GitHub noreply without ID
    local, gh = email_local("dushan6693@users.noreply.github.com")
    assert local == "dushan6693"
    assert gh == "dushan6693"

    # Plus-addressing
    local, gh = email_local("student+cs101@university.edu")
    assert local == "student"
    assert gh is None


def test_jaccard_similarity():
    s1 = {"dushan", "madushanka", "beligala"}
    s2 = {"dushan", "madushanka"}
    assert calculate_jaccard_similarity(s1, s2) == 2 / 3


def test_solo_project_detection_single_author():
    authors = [{"id": 1, "name": "Dushan Madushanka", "email": "dushan@example.com"}]
    res = analyze_identity_signals(authors=authors)
    assert res["is_solo_project"] is True
    assert res["canonical_contributor_count"] == 1
    assert res["raw_identity_count"] == 1
    assert res["resolved_alias_count"] == 0


def test_solo_project_detection_merged_aliases():
    authors = [
        {"id": 1, "name": "Dushan Madushanka", "email": "dushan@example.com"},
        {"id": 2, "name": "dushan6693", "email": "dushan6693@users.noreply.github.com"},
    ]
    canonical_map = {1: 1, 2: 1}  # Merged by lecturer
    res = analyze_identity_signals(authors=authors, canonical_id_map=canonical_map)
    assert res["is_solo_project"] is True
    assert res["canonical_contributor_count"] == 1
    assert res["raw_identity_count"] == 2
    assert res["resolved_alias_count"] == 1


def test_split_identity_noreply_and_token_overlap():
    authors = [
        {"id": 1, "name": "Dushan Madushanka", "email": "dushan@example.com"},
        {"id": 2, "name": "dushan6693", "email": "dushan6693@users.noreply.github.com"},
    ]
    res = analyze_identity_signals(authors=authors)
    assert res["is_solo_project"] is False
    assert len(res["suspected_same_person"]) == 1

    issue = res["suspected_same_person"][0]
    assert issue["kind"] == "split_identity"
    assert issue["confidence"] == "HIGH"
    assert "dushan" in issue["matched_tokens"] or "dushan6693" in issue["matched_tokens"]
    assert "dushan6693" in issue["members"][1]


def test_split_identity_exact_name_different_email():
    authors = [
        {"id": 1, "name": "John Doe", "email": "john.doe@work.com"},
        {"id": 2, "name": "John Doe", "email": "johndoe@personal.org"},
    ]
    res = analyze_identity_signals(authors=authors)
    assert len(res["suspected_same_person"]) == 1
    issue = res["suspected_same_person"][0]
    assert issue["confidence"] == "HIGH"
    assert "Exact display name match" in issue["evidence"][0]


def test_shared_account_multiple_display_names():
    authors = [
        {
            "id": 1,
            "name": "Team Lead",
            "email": "group1@university.edu",
            "name_variants": ["Alice Smith", "Bob Jones"],
        }
    ]
    res = analyze_identity_signals(authors=authors)
    assert len(res["shared_accounts"]) == 1
    issue = res["shared_accounts"][0]
    assert issue["kind"] == "shared_account"
    assert issue["confidence"] == "HIGH"
    assert "Alice Smith" in issue["matched_tokens"]
    assert "Bob Jones" in issue["matched_tokens"]


def test_pushed_by_other_commits():
    authors = [{"id": 1, "name": "Alice", "email": "alice@university.edu"}]
    commits = [
        {"author_id": 1, "committer_email": "bob@university.edu"},
        {"author_id": 1, "committer_email": "bob@university.edu"},
        {"author_id": 1, "committer_email": "bob@university.edu"},
        {"author_id": 1, "committer_email": "alice@university.edu"},
    ]
    res = analyze_identity_signals(authors=authors, commits=commits)
    assert len(res["pushed_by_other"]) == 1
    issue = res["pushed_by_other"][0]
    assert issue["kind"] == "pushed_by_other"
    assert "75%" in issue["evidence"][0]
