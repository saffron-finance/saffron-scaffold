import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto'
import { verifyMessage } from 'viem'
import { CHAIN_ID, validAddress, walletSessionMessage, fault } from '../shared/incentives.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')

/** Application-owned wallet sessions. Logging in never authorizes deployment or funding. */
export function createWalletAuth({ origin, basePath = '', operators = [], now = Date.now } = {}) {
  const sessionOrigin = origin ? new URL(origin).origin : null
  const allowed = new Set(operators.filter(validAddress).map(value => value.toLowerCase()))
  const challenges = new Map(), sessions = new Map()
  const cookieName = 'saffron_incentives_' + hash((sessionOrigin ?? '') + basePath).slice(0,8)
  const cookiePath = (basePath || '') + '/api/incentives'
  const permitted = wallet => validAddress(wallet) && allowed.has(wallet.toLowerCase())
  function checkOrigin(req) {
    if (!sessionOrigin) throw fault(503,'The application origin is not configured.')
    if (req.headers.origin !== sessionOrigin) throw fault(403,'This action must originate in this application.')
  }
  function prune() {
    for(const [id,entry] of challenges) if(entry.expires<=now()) challenges.delete(id)
    for(const [id,entry] of sessions) if(entry.expires<=now()) sessions.delete(id)
  }
  function cookie(value,maxAge) {
    return `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=${cookiePath}; Max-Age=${maxAge}${sessionOrigin?.startsWith('https:')?'; Secure':''}`
  }
  const auth = {
    origin: sessionOrigin, permitted, checkOrigin,
    /** A canonical fee payment plus its private recovery capability replaces
     * public-user message signing. A transaction hash by itself is not a login.
     */
    grantPayment(req,res,wallet){
      checkOrigin(req);prune()
      if(sessions.size>=5000)throw fault(429,'Sessions are busy. Retry shortly without paying again.')
      if(!validAddress(wallet))throw fault(401,'Verified payer is required.')
      const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex')
      const session={wallet:wallet.toLowerCase(),csrf,expires:now()+30*60_000}
      sessions.set(hash(token),session);res.setHeader('Set-Cookie',cookie(token,1800))
      return {...session,operator:permitted(wallet)}
    },
    challenge(req,wallet) {
      checkOrigin(req); prune()
      if(!permitted(wallet)) throw fault(403,'Message sign-in is only for configured operators. Users pay the ETH creation fee.')
      if(challenges.size>=200) throw fault(429,'Too many sign-in requests. Retry shortly.')
      const proof={origin:sessionOrigin,wallet:wallet.toLowerCase(),chainId:CHAIN_ID,nonce:randomUUID(),expiresAt:new Date(now()+300_000).toISOString()}
      challenges.set(proof.nonce,{proof,expires:now()+300_000})
      return proof
    },
    async login(req,res,body) {
      checkOrigin(req); prune()
      const entry=challenges.get(body?.nonce)
      if(!entry || !validAddress(body.wallet) || body.wallet.toLowerCase()!==entry.proof.wallet) throw fault(401,'Request a fresh wallet challenge.')
      challenges.delete(body.nonce)
      let verified=false
      try { verified=await verifyMessage({address:entry.proof.wallet,message:walletSessionMessage(entry.proof),signature:body.signature}) } catch {}
      if(!verified || entry.expires<=now()) throw fault(401,'Invalid or expired wallet signature.')
      if(sessions.size>=5000) throw fault(429,'Sign-in is busy. Retry shortly.')
      const token=randomBytes(32).toString('hex'), csrf=randomBytes(32).toString('hex')
      const session={wallet:entry.proof.wallet,csrf,expires:now()+30*60_000}
      sessions.set(hash(token),session)
      res.setHeader('Set-Cookie',cookie(token,1800))
      return {...session,operator:permitted(session.wallet)}
    },
    session(req,{mutation=false,operator=false}={}) {
      prune()
      const part=(req.headers.cookie??'').split(';').map(value=>value.trim()).find(value=>value.startsWith(cookieName+'='))
      const session=part&&sessions.get(hash(part.slice(cookieName.length+1)))
      if(!session) throw fault(401,'Sign in with your wallet.')
      if(operator && !permitted(session.wallet)) throw fault(403,'Operator access is required.')
      if(mutation){
        checkOrigin(req)
        const supplied=Buffer.from(String(req.headers['x-saffron-csrf']??'')), expected=Buffer.from(session.csrf)
        if(supplied.length!==expected.length || !timingSafeEqual(supplied,expected)) throw fault(403,'Refresh your wallet session before continuing.')
      }
      return {...session,operator:permitted(session.wallet)}
    },
    logout(req,res) {
      auth.session(req,{mutation:true})
      const part=(req.headers.cookie??'').split(';').map(value=>value.trim()).find(value=>value.startsWith(cookieName+'='))
      if(part) sessions.delete(hash(part.slice(cookieName.length+1)))
      res.setHeader('Set-Cookie',cookie('',0))
    },
  }
  return auth
}
