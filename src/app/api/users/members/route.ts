import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/sso/errors';
import { applicationMembers } from '@/lib/sso/member-directory';

export async function GET(req: NextRequest) {
  try {
    const members = await applicationMembers(req, false);
    return NextResponse.json({ members }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return handleApiError(error, '读取公司应用成员失败'); }
}
