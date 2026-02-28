import { NextRequest, NextResponse } from 'next/server';
import { createUser } from '@/lib/local-users';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { email, password, name } = body;

        if (!email || !password) {
            return NextResponse.json(
                { error: 'Email and password are required' },
                { status: 400 }
            );
        }

        if (password.length < 6) {
            return NextResponse.json(
                { error: 'Password must be at least 6 characters' },
                { status: 400 }
            );
        }

        const user = await createUser(email, password, name || '');

        return NextResponse.json({
            message: 'Registration successful',
            user: { id: user.id, email: user.email, name: user.name },
        }, { status: 201 });

    } catch (error: any) {
        console.error('Registration error:', error);
        const message = error?.message || 'Registration failed. Please try again.';
        return NextResponse.json({ error: message }, { status: 400 });
    }
}
