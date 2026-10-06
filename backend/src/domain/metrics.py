from typing import Sequence, Union

def calculate_gini(contributions: Sequence[Union[int, float]]) -> float:
    """
    Calculates the Gini coefficient for a sequence of contribution values.
    Returns a float between 0.0 (perfect equality) and 1.0 (maximum inequality).
    """
    if not contributions or sum(contributions) == 0:
        return 0.0
    n = len(contributions)
    if n == 1:
        return 0.0

    sorted_contribs = sorted(contributions)
    tot = sum(sorted_contribs)
    if tot == 0:
        return 0.0

    idx_sum = sum((i + 1) * val for i, val in enumerate(sorted_contribs))
    gini_val = (2.0 * idx_sum) / (n * tot) - (n + 1.0) / n
    return max(0.0, round(gini_val, 4))


def get_gini_status(gini_val: float) -> str:
    """
    Returns the standardized risk classification string for a given Gini coefficient value.
    """
    if gini_val < 0.3:
        return "Low Risk"
    elif gini_val < 0.5:
        return "Medium Risk"
    else:
        return "High Risk"
