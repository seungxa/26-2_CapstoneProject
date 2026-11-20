"""Loopback-only Supabase protocol fixture. No cloud/Auth data or paid provider."""
import argparse,json,os,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlsplit,parse_qs
import jwt
A='00000000-0000-0000-0000-000000000001'
B='00000000-0000-0000-0000-000000000002'
parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8022);args=parser.parse_args()
secret=os.environ['PRACTICE_TRACK_TEST_JWT_SECRET'];issuer=f'http://127.0.0.1:{args.port}/auth/v1'
def user(subject):
 return dict(id=subject,aud='authenticated',role='authenticated',email='practice@example.invalid' if subject==A else 'second@example.invalid',email_confirmed_at='2026-01-01T00:00:00Z',created_at='2026-01-01T00:00:00Z',updated_at='2026-01-01T00:00:00Z',app_metadata={'provider':'email','providers':['email']},user_metadata={},identities=[])
def session(subject):
 now=int(time.time());token=jwt.encode(dict(sub=subject,aud='authenticated',iss=issuer,role='authenticated',exp=now+7200,iat=now),secret,algorithm='HS256')
 return dict(access_token=token,token_type='bearer',expires_in=7200,expires_at=now+7200,refresh_token='fixture-'+subject,user=user(subject))
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*_):pass
 def send(self,status,value=None):
  data=b'' if value is None else json.dumps(value).encode();self.send_response(status)
  self.send_header('Content-Type','application/json');self.send_header('Access-Control-Allow-Origin','*');self.send_header('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version');self.send_header('Access-Control-Allow-Methods','GET,POST,OPTIONS');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
 def do_OPTIONS(self):self.send(204)
 def do_GET(self):
  url=urlsplit(self.path)
  if url.path=='/health':return self.send(200,{'fixture':True})
  if url.path=='/__test/session':return self.send(200,session(B if parse_qs(url.query).get('user')==['B'] else A))
  if url.path=='/auth/v1/user':
   try:
    claims=jwt.decode(self.headers.get('Authorization','').removeprefix('Bearer '),secret,algorithms=['HS256'],audience='authenticated',issuer=issuer)
    return self.send(200,user(claims['sub']))
   except jwt.PyJWTError:return self.send(401,{'message':'Invalid local fixture session'})
  self.send(404,{'message':'Fixture endpoint not implemented'})
 def do_POST(self):
  body=self.rfile.read(int(self.headers.get('Content-Length',0)))
  if urlsplit(self.path).path=='/auth/v1/logout':return self.send(204)
  if urlsplit(self.path).path=='/auth/v1/token':
   data=json.loads(body or b'{}');grant=parse_qs(urlsplit(self.path).query).get('grant_type',[''])[0]
   if grant=='password':
    if data.get('email') not in ['practice@example.invalid','second@example.invalid'] or data.get('password')!='local-test-only':return self.send(400,{'msg':'Use only the documented local fixture account','error_code':'invalid_credentials'})
    subject=B if data['email']=='second@example.invalid' else A
   elif grant=='refresh_token':subject=B if data.get('refresh_token')=='fixture-'+B else A
   else:return self.send(400,{'msg':'Unsupported fixture grant'})
   return self.send(200,session(subject))
  self.send(404,{'message':'Fixture endpoint not implemented'})
ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
