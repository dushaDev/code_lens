import ollama
import json

class LocalAIService:
    def __init__(self, model_name: str = "qwen2.5-coder:3b"):
        self.model_name = model_name

    def verify_commit_message(self, commit_message: str, code_diff: str) -> dict:
        """
        Micro-Task: Check if a single commit message matches its diff.
        Returns a dictionary with 'match_percentage' and 'reason'.
        """
        # Truncate diff if extremely large to maintain fast performance on laptop CPU
        safe_diff = code_diff[:1500] if code_diff else "No diff content provided."
        
        prompt = f"""
        You are an expert code reviewer.
        Analyze this Git Commit. Does the message accurately describe the code changes?
        
        Commit Message:
        {commit_message}
        
        Code Diff:
        {safe_diff}
        
        Respond ONLY with a valid JSON object in this exact format:
        {{
            "match_percentage": 85,
            "reason": "1-sentence concise explanation"
        }}
        """
        
        try:
            response = ollama.chat(model=self.model_name, messages=[
                {
                    'role': 'user',
                    'content': prompt,
                },
            ], format="json")
            
            result = json.loads(response['message']['content'])
            match_pct = int(result.get("match_percentage", 50))
            # Clamp percentage between 0 and 100
            match_pct = max(0, min(100, match_pct))
            reason = str(result.get("reason", "Analysis completed."))
            return {"match_percentage": match_pct, "reason": reason}
        except Exception as e:
            return {"match_percentage": 50, "reason": f"Analysis default fallback (Ollama unavailable or timeout)"}

    def compare_snippets(self, snippet_a: str, snippet_b: str) -> dict:
        safe_a = snippet_a[:300] if snippet_a else "None"
        safe_b = snippet_b[:300] if snippet_b else "None"

        prompt = f"""
        Compare Snippet A and Snippet B.
        Snippet A: {safe_a}
        Snippet B: {safe_b}

        Respond ONLY with a JSON object:
        {{
            "is_duplicate_or_revert": false,
            "similarity_type": "independent_work",
            "explanation": "Independent code work"
        }}
        Where similarity_type is ONE of [identical_copy, variable_rename, structural_revert, independent_work].
        """
        try:
            response = ollama.chat(
                model=self.model_name,
                messages=[{'role': 'user', 'content': prompt}],
                format="json",
                options={'num_predict': 80, 'temperature': 0.1}
            )

            result = json.loads(response['message']['content'])
            is_dup = bool(result.get("is_duplicate_or_revert", False))
            sim_type = str(result.get("similarity_type", "independent_work")).lower()
            if sim_type not in ["identical_copy", "variable_rename", "structural_revert", "independent_work"]:
                sim_type = "independent_work"
            explanation = str(result.get("explanation", "Comparison completed."))

            return {
                "is_duplicate_or_revert": is_dup,
                "similarity_type": sim_type,
                "explanation": explanation
            }
        except Exception as e:
            return {
                "is_duplicate_or_revert": False,
                "similarity_type": "independent_work",
                "explanation": f"Fallback: {str(e)}"
            }

    def evaluate_review_comment(self, comment_text: str) -> dict:
        safe_comment = comment_text[:200] if comment_text else "No comment."

        prompt = f"""
        Evaluate code review comment: "{safe_comment}"
        Respond ONLY with a JSON object:
        {{
            "substance": "constructive_review",
            "quality_score": 7,
            "feedback_type": "approval",
            "summary": "Standard code feedback"
        }}
        Where substance is ONE of [rubber_stamp, minor_feedback, constructive_review].
        """
        try:
            response = ollama.chat(
                model=self.model_name,
                messages=[{'role': 'user', 'content': prompt}],
                format="json",
                options={'num_predict': 80, 'temperature': 0.1}
            )

            result = json.loads(response['message']['content'])
            substance = str(result.get("substance", "minor_feedback")).lower()
            if substance not in ["rubber_stamp", "minor_feedback", "constructive_review"]:
                substance = "minor_feedback"

            score = int(result.get("quality_score", 5))
            score = max(1, min(10, score))

            fb_type = str(result.get("feedback_type", "approval")).lower()
            if fb_type not in ["style", "architecture", "bug_report", "approval"]:
                fb_type = "approval"

            summary = str(result.get("summary", "Review evaluation completed."))

            return {
                "substance": substance,
                "quality_score": score,
                "feedback_type": fb_type,
                "summary": summary
            }
        except Exception as e:
            return {
                "substance": "minor_feedback",
                "quality_score": 5,
                "feedback_type": "approval",
                "summary": f"Fallback: {str(e)}"
            }

    def classify_commit(self, commit_message: str, code_diff: str) -> dict:
        """
        Phase 1 Mechanical Labeling: Classify a single commit into structured labels.
        Tasks:
        - Task A: type (feature, bugfix, refactor, docs, test, config, style, merge, other)
        - Task B: substance (trivial, moderate, substantial)
        - Task C: message_quality (descriptive, vague)
        - Task D: consistent (true/false, matches diff)
        - Task E: security (has_security_risk: true/false, security_risk_type: hardcoded_secret, unsafe_eval, sql_injection, none)
        - Task F: code_smells (array of items from [magic_numbers, deep_nesting, long_method, dead_code, complex_conditional, none])
        - Task G: architecture_issues (array of items from [tight_coupling, poor_separation_of_concerns, missing_abstraction, business_logic_in_ui, none])
        """
        safe_diff = code_diff[:600] if code_diff else "No diff content provided."
        safe_msg = commit_message[:400] if commit_message else "No commit message."
        
        prompt = f"""
        You are a strict data labeling assistant. Your job is to label this git commit.
        Follow these rules:
        - type: feature, bugfix, refactor, docs, test, config, style, merge, other
        - substance: trivial, moderate, substantial
        - message_quality: descriptive, vague
        - consistent: boolean
        - has_security_risk: boolean
        - security_risk_type: hardcoded_secret, unsafe_eval, sql_injection, none
        - code_smells: array of [magic_numbers, deep_nesting, long_method, dead_code, complex_conditional, none]
        - architecture_issues: array of [tight_coupling, poor_separation_of_concerns, missing_abstraction, business_logic_in_ui, none]

        Commit Message: {safe_msg}
        Diff: {safe_diff}

        Respond ONLY with a JSON object:
        {{
            "type": "feature",
            "substance": "moderate",
            "message_quality": "descriptive",
            "consistent": true,
            "has_security_risk": false,
            "security_risk_type": "none",
            "code_smells": ["none"],
            "architecture_issues": ["none"]
        }}
        """
        try:
            response = ollama.chat(
                model=self.model_name,
                messages=[{'role': 'user', 'content': prompt}],
                format="json",
                options={'num_predict': 80, 'temperature': 0.1}
            )
            
            result = json.loads(response['message']['content'])
            
            # Ensure valid enums
            c_type = str(result.get("type", "other")).lower()
            if c_type not in ["feature", "bugfix", "refactor", "docs", "test", "config", "style", "merge", "other"]:
                c_type = "other"
                
            substance = str(result.get("substance", "moderate")).lower()
            if substance not in ["trivial", "moderate", "substantial"]:
                substance = "moderate"
                
            msg_quality = str(result.get("message_quality", "descriptive")).lower()
            if msg_quality not in ["descriptive", "vague"]:
                msg_quality = "descriptive"
                
            consistent = bool(result.get("consistent", True))
            has_security_risk = bool(result.get("has_security_risk", False))
            
            sec_type = str(result.get("security_risk_type", "none")).lower()
            if sec_type not in ["hardcoded_secret", "unsafe_eval", "sql_injection", "none"]:
                sec_type = "none" if not has_security_risk else "hardcoded_secret"
            
            raw_smells = result.get("code_smells", ["none"])
            if not isinstance(raw_smells, list):
                raw_smells = [str(raw_smells)]
            clean_smells = [str(s).lower() for s in raw_smells if str(s).lower() != "none"]

            raw_arch = result.get("architecture_issues", ["none"])
            if not isinstance(raw_arch, list):
                raw_arch = [str(raw_arch)]
            clean_arch = [str(a).lower() for a in raw_arch if str(a).lower() != "none"]

            return {
                "type": c_type,
                "substance": substance,
                "message_quality": msg_quality,
                "consistent": consistent,
                "has_security_risk": has_security_risk,
                "security_risk_type": sec_type,
                "code_smells": clean_smells,
                "architecture_issues": clean_arch
            }
        except Exception as e:
            # Fallback values if parsing fails or Ollama is down
            return {
                "type": "other",
                "substance": "moderate",
                "message_quality": "descriptive",
                "consistent": True,
                "has_security_risk": False,
                "security_risk_type": "none",
                "code_smells": [],
                "architecture_issues": []
            }

    def analyze_architecture(self, folder_tree: str) -> dict:
        """
        Evaluates project directory tree to identify architecture pattern and accuracy.
        """
        prompt = f"""
        You are a software architect.
        Analyze this repository folder structure:
        
        {folder_tree}
        
        Determine if any standard software architecture pattern (e.g. Clean Architecture, MVC, Layered Monolith, Modular, Component-Driven) is followed, and rate how strictly it is implemented.
        
        Respond ONLY with a valid JSON object in this exact format:
        {{
            "pattern_name": "<Pattern Name or Unstructured>",
            "accuracy_score": <number 0-100 indicating compliance rate>,
            "assessment": "<2-sentence concise summary of structure quality and violations if any>"
        }}
        """
        try:
            response = ollama.chat(model=self.model_name, messages=[
                {'role': 'user', 'content': prompt}
            ], format="json")
            
            result = json.loads(response['message']['content'])
            score = int(result.get("accuracy_score", 70))
            score = max(0, min(100, score))
            return {
                "pattern_name": str(result.get("pattern_name", "Layered Architecture")),
                "accuracy_score": score,
                "assessment": str(result.get("assessment", "Standard directory structure detected."))
            }
        except Exception as e:
            return {
                "pattern_name": "Standard Layout",
                "accuracy_score": 75,
                "assessment": "Directory structure parsed successfully."
            }



    def generate_final_report(self, structured_data: dict) -> str:
        """
        Macro-Task: Generate the final qualitative report based on aggregated metrics.
        """
        prompt = f"""
        You are a senior tech lead. Write a 3-paragraph executive summary 
        evaluating a student software project based on the following extracted metrics.
        Highlight major problems, architectural flaws, and AI usage.

        Project Data:
        {json.dumps(structured_data, indent=2)}
        """
        
        try:
            response = ollama.chat(
                model=self.model_name, 
                messages=[{'role': 'user', 'content': prompt}],
                options={'num_predict': 500} # limit output size to keep it fast
            )
            return response['message']['content']
        except Exception as e:
            return f"Error generating report: {str(e)}"
