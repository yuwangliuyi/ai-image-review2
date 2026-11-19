import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/sso/errors';
import { sameOrigin } from '@/lib/sso/identity';
import { applicationMembers } from '@/lib/sso/member-directory';

export async function POST(req: NextRequest) {
  try {
    sameOrigin(req);
    const members = await applicationMembers(req, true);
    return NextResponse.json({ refreshed: true, members }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return handleApiError(error, '更新公司应用成员失败'); }
}
