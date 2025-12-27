import os
import ast
import time
from openai import OpenAI
from dotenv import load_dotenv
from prompts import PROMPT_RELEVANT_DFS, PROMPT_PYTHON_CODE, PROMPT_IMPROVE_CODE, PROMPT_IDEAS

load_dotenv()
openai_api_key = os.getenv("OPENAI_API_KEY", "")
if not openai_api_key:
    print("Warning: OPENAI_API_KEY not set in .env file.")
openai_client = OpenAI(api_key=openai_api_key)
os.environ["TOKENIZERS_PARALLELISM"] = "false"

def format_dfs_for_prompt(dfs):
    formatted = []
    for name, df in dfs.items():
        sample_size = min(5, len(df))
        formatted.append(f"### DataFrame: {name}\n{df.sample(sample_size).to_csv(index=False, header=True, lineterminator='; ')}\n")
    return "\n".join(formatted)

def compose_prompt(prompt_func, *args):
    prompt = prompt_func(*args)
    return prompt
    
def ask_llm(prompt):
    # Wrap LLM call with timeout and simple retry/backoff
    timeout = 30
    max_retries = 2

    for attempt in range(1, max_retries + 1):
        try:
            response = openai_client.responses.create(
                model="gpt-4o",
                input=prompt,
                timeout=timeout,
            )
            return response.output[0].content[0].text.strip()
        except Exception as e:
            if attempt < max_retries:
                # Exponential backoff with jitter
                sleep_time = (2 ** (attempt - 1)) + (0.1 * attempt)
                time.sleep(sleep_time)
                continue
            # Final failure: return error string for upstream handling
            return f"error: {type(e).__name__}: {str(e)}"


class ChartCodeGenerator:
    def __init__(self, all_dfs=[]):
        self.all_dfs = all_dfs
        self.history = []
        self.relevant_dfs_formatted = None

    def generate_prompt_ideas(self):
        all_dfs_formatted_for_prompt = format_dfs_for_prompt(self.all_dfs)
        prompt = compose_prompt(PROMPT_IDEAS, all_dfs_formatted_for_prompt)
        ideas_str = ask_llm(prompt)
        return ideas_str
    
    def generate_chart_code(self, user_query: str):
        all_dfs_formatted_for_prompt = format_dfs_for_prompt(self.all_dfs)
        prompt = compose_prompt(PROMPT_RELEVANT_DFS, user_query, all_dfs_formatted_for_prompt)
        relevant_dfs_str = ask_llm(prompt)

        if relevant_dfs_str[0:5].lower() == 'error':
            result = {
                'error': relevant_dfs_str
            }
            return False, result

        try:
            relevant_dfs_names = ast.literal_eval(relevant_dfs_str)
        except Exception as e:
            result = {
                'error': f'Malformed dfs: {e}'
            }
            return False, result

        try:
            relevant_dfs = {df_name: self.all_dfs[df_name] for df_name in relevant_dfs_names}
        except KeyError as e:
            result = {
                'error': f'DataFrame not found: {e}'
            }
            return False, result

        self.relevant_dfs_formatted = format_dfs_for_prompt(relevant_dfs)
        prompt = compose_prompt(PROMPT_PYTHON_CODE, user_query, self.relevant_dfs_formatted)

        generated_code = ask_llm(prompt)
        # Make sure to strip any code block markings, just in case it happens
        generated_code = "\n".join(
            line for line in generated_code.splitlines() if not line.strip().startswith("```")
        )

        history_entry = {
            'query': user_query,
            'code': generated_code
        }
        self.history.append(history_entry)
        
        return True, history_entry

    def improve_chart_code(self, improvement_query: str, improvement_entry_index: int):
        if len(self.history) == 0:
            result = {
                'error': 'No chart code to improve. Generate a chart first.'
            }
            return False, result
        
        base_entry = self.history[improvement_entry_index]
        prompt = compose_prompt(
            PROMPT_IMPROVE_CODE,
            ' / '.join([entry['query'] for entry in self.history]),
            base_entry['code'],
            self.relevant_dfs_formatted,
            improvement_query
        )

        improved_code_str = ask_llm(prompt)
        improved_code_str = "\n".join(
            line for line in improved_code_str.splitlines() if not line.strip().startswith("```")
        )

        if improved_code_str[0:5].lower() == 'error':
            result = {
                'error': improved_code_str
            }
            return False, result
        
        history_entry = {
            'query': improvement_query,
            'code': improved_code_str,
        }
        self.history.append(history_entry)
        return True, history_entry

    def get_history(self):
        return self.history