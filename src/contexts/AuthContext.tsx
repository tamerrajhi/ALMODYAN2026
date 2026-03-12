import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface AuthUser {
  id: string;
  email: string;
  user_metadata: {
    full_name: string | null;
    username: string | null;
    avatar_url: string | null;
  };
  app_metadata: Record<string, unknown>;
  aud: string;
  created_at: string;
  role: string;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  signIn: (emailOrUsername: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  getEmailByUsername: (username: string) => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface SessionMeResponse {
  user: {
    id: string;
    email: string;
    username: string | null;
    full_name: string | null;
    avatar_url: string | null;
    default_branch_id: string | null;
  };
  profile: {
    id: string;
    user_id: string;
    is_active: boolean;
  };
  roles: string[];
  branches: Array<{ branch_id: string; branch_name: string }>;
}

function toAuthUser(data: SessionMeResponse): AuthUser {
  return {
    id: data.user.id,
    email: data.user.email,
    user_metadata: {
      full_name: data.user.full_name,
      username: data.user.username,
      avatar_url: data.user.avatar_url,
    },
    app_metadata: {},
    aud: 'authenticated',
    created_at: '',
    role: data.roles?.[0] || '',
  };
}

async function sessionMe(): Promise<SessionMeResponse | null> {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function sessionLogin(emailOrUsername: string, password: string): Promise<{ data: SessionMeResponse | null; error: Error | null }> {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email_or_username: emailOrUsername, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Login failed' }));
      return { data: null, error: new Error(body.error || 'Login failed') };
    }
    const data = await res.json();
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err : new Error('Login failed') };
  }
}

async function sessionLogout(): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
  }).catch(() => {});
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const meData = await sessionMe();
      if (!mounted) return;
      if (meData) {
        const authUser = toAuthUser(meData);
        setUser(authUser);
        console.info(`%c[AUTH_USER:session] id=${authUser.id} email=${authUser.email}`, 'color:#f59e0b;font-weight:bold');
      } else {
        setUser(null);
      }
      setLoading(false);
    })();

    return () => { mounted = false; };
  }, []);

  const getEmailByUsername = async (username: string): Promise<string | null> => {
    try {
      const res = await fetch(`/api/auth/lookup-username?username=${encodeURIComponent(username)}`);
      if (!res.ok) return null;
      const body = await res.json();
      return body.email || null;
    } catch {
      return null;
    }
  };

  const signIn = async (emailOrUsername: string, password: string) => {
    const { data, error } = await sessionLogin(emailOrUsername, password);
    if (error) return { error };
    if (data) {
      setUser(toAuthUser(data));
    }
    return { error: null };
  };

  const signOut = async () => {
    await sessionLogout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, getEmailByUsername }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
