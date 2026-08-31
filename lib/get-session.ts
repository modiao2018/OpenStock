import { cache } from 'react';
import { headers } from 'next/headers';
import { auth } from '@/lib/better-auth/auth';

// Layout and page each need the session; React cache() collapses them into
// one Mongo session read per request
export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));
