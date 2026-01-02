"""
User Email Authentication Middleware

Extracts user email from X-User-Email header (sent from NextAuth session)
and makes it available on the request object for ViewSet filtering.
"""

class UserEmailMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Get user email from header (set by Next.js frontend from NextAuth session)
        user_email = request.headers.get('X-User-Email', None)
        
        # Also check query param as fallback for testing
        if not user_email:
            user_email = request.GET.get('user_email', None)
        
        request.user_email = user_email
        response = self.get_response(request)
        return response
