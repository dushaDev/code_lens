import asyncio
from src.infrastructure.services.local_ai_service import LocalAIService

async def test():
    ai = LocalAIService()
    print('Testing...')
    try:
        import ollama
        response = ollama.chat(
            model=ai.model_name,
            messages=[{'role': 'user', 'content': 'Hello? Respond in JSON: { "response": "yes" }'}],
            format='json'
        )
        print('Raw response:', response['message']['content'])
    except Exception as e:
        print('Error:', e)

asyncio.run(test())
