import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { email, password, name } = body;

        // Validate input
        if (!email || !password) {
            return NextResponse.json(
                { error: 'Email and password are required' },
                { status: 400 }
            );
        }

        // Call backend registration endpoint
        const response = await fetch('http://localhost:8001/api/auth/register/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email,
                password,
                password2: password,
                name: name || '',
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            // Return backend validation errors
            return NextResponse.json(data, { status: response.status });
        }

        // Success - return user data
        return NextResponse.json({
            message: data.message,
            user: data.user,
        }, { status: 201 });

    } catch (error: any) {
        console.error('Registration error:', error);
        return NextResponse.json(
            { error: 'Registration failed. Please try again.' },
            { status: 500 }
        );
    }
}
