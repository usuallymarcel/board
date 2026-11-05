"""Just enough of users-api for browser tests, with the same contract board relies on:
GET /api/health capabilities, POST /api/token, login and sign_up answering verified true or false
with a Secure session cookie. Run with uvicorn; state lives in memory."""
import secrets

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

app = FastAPI()
users: dict[str, dict] = {}
sessions: dict[str, dict] = {}
state = {'down': False}


def with_session(user: dict) -> JSONResponse:
    token = secrets.token_hex(16)
    sessions[token] = user
    response = JSONResponse({'verified': True, 'message': 'ok', 'user': user})
    response.headers['set-cookie'] = f'session_id={token}; HttpOnly; Max-Age=2592000; Path=/; SameSite=lax; Secure'
    return response


@app.get('/api/health')
def health(response: Response):
    if state['down']:
        response.status_code = 503
        return {'status': 'unavailable', 'capabilities': []}
    return {'status': 'ok', 'capabilities': ['session-introspection', 'remember-me']}


@app.post('/test/down/{value}')
def set_down(value: int):
    state['down'] = bool(value)
    return state


@app.post('/api/token')
async def token(request: Request):
    user = sessions.get((await request.json())['token'])
    if user is None:
        return JSONResponse({'detail': 'Invalid Session'}, status_code=401)
    return {'verified': True, 'user': user}


@app.post('/api/users/sign_up')
async def sign_up(request: Request):
    body = await request.json()
    if body['name'] in users:
        return {'verified': False, 'message': 'user exists already for that name'}
    user = {'id': len(users) + 1, 'name': body['name']}
    users[body['name']] = {**user, 'password': body['password']}
    return with_session(user)


@app.post('/api/users/login')
async def login(request: Request):
    body = await request.json()
    found = users.get(body['name'])
    if not found or found['password'] != body['password']:
        return {'verified': False, 'message': 'Incorrect login details'}
    return with_session({'id': found['id'], 'name': found['name']})


@app.post('/api/users/logout')
def logout():
    return {'ok': True}
