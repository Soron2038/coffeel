/**
 * HTTP Basic Authentication middleware for admin endpoints
 * Uses ADMIN_USER and ADMIN_PASS from environment variables
 */
export function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="CofFeEL Admin"');
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  try {
    // Decode Base64 credentials
    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');
    const [username, password] = credentials.split(':');
    
    // Check credentials against environment variables
    const validUsername = process.env.ADMIN_USER || 'admin';
    const validPassword = process.env.ADMIN_PASS || 'changeme';
    
    if (username === validUsername && password === validPassword) {
      // Authentication successful
      req.admin = { username };
      return next();
    }
    
    // Invalid credentials
    res.setHeader('WWW-Authenticate', 'Basic realm="CofFeEL Admin"');
    return res.status(401).json({ error: 'Invalid credentials' });
    
  } catch (error) {
    console.error('❌ Auth error:', error);
    return res.status(500).json({ error: 'Authentication error' });
  }
}

/**
 * Optional admin authentication - sets req.isAdmin if authenticated
 * Doesn't block request if not authenticated
 */
export function optionalAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Basic ')) {
    try {
      const base64Credentials = authHeader.split(' ')[1];
      const credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');
      const [username, password] = credentials.split(':');
      
      const validUsername = process.env.ADMIN_USER || 'admin';
      const validPassword = process.env.ADMIN_PASS || 'changeme';
      
      if (username === validUsername && password === validPassword) {
        req.isAdmin = true;
        req.admin = { username };
      }
    } catch (error) {
      // Silently fail - optional auth
    }
  }
  
  next();
}
