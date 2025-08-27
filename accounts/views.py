from django.urls import reverse_lazy, reverse
from django.views import generic
from django.contrib import messages
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from django.core.mail import EmailMessage
from django.template.loader import render_to_string
from django.shortcuts import render, redirect
from django.utils.html import mark_safe
from django.conf import settings
from chat.mongo import get_db
from datetime import datetime
from .forms import CustomUserCreationForm
from django.contrib.auth.views import LoginView
from django_ratelimit.decorators import ratelimit
from django.apps import apps
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken # Import RefreshToken

class CustomLoginView(LoginView):
    template_name = 'registration/login.html'

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        # Add an empty token to the context by default
        context['access_token'] = None
        return context

    def form_valid(self, form):
        response = super().form_valid(form)
        user = form.get_user()
        if user:
            refresh = RefreshToken.for_user(user)
            access_token = str(refresh.access_token)
            # Pass the access token to the template context
            redirect_url = reverse('home')
            response = redirect(redirect_url)
            # Set the access token in an HTTP-only cookie for security
            response.set_cookie(
                key=settings.SIMPLE_JWT['AUTH_COOKIE'],
                value=access_token,
                expires=settings.SIMPLE_JWT['ACCESS_TOKEN_LIFETIME'],
                secure=settings.SIMPLE_JWT['AUTH_COOKIE_SECURE'],
                httponly=settings.SIMPLE_JWT['AUTH_COOKIE_HTTP_ONLY'],
                samesite=settings.SIMPLE_JWT['AUTH_COOKIE_SAMESITE']
            )
        return response

    def dispatch(self, request, *args, **kwargs):
        # Ensure the correct user model is used for authentication
        self.model = get_user_model()
        return super().dispatch(request, *args, **kwargs)

class SignUpView(generic.CreateView):
    form_class = CustomUserCreationForm
    success_url = reverse_lazy('login')
    template_name = 'registration/signup.html'

    def form_valid(self, form):
        user = form.save(commit=False)
        user.is_active = False  # Deactivate account until email is verified
        user.save()

        try:
            db = get_db()
            db.users.insert_one({
                "username": user.username,
                "email": user.email,
                "date_joined": datetime.utcnow(),
                "email_verified": False,
            })
        except Exception as e:
            messages.warning(self.request, f"Account created, but failed to save in MongoDB: {e}")

        # Send verification email
        current_site = self.request.get_host()
        mail_subject = 'Activate your account.'
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = default_token_generator.make_token(user)
        activation_link = self.request.build_absolute_uri(
            reverse_lazy('activate', kwargs={'uidb64': uid, 'token': token})
        )
        message = render_to_string('accounts/acc_active_email.html', {
            'user': user,
            'domain': current_site,
            'uid': uid,
            'token': token,
            'activation_link': activation_link,
        })
        to_email = form.cleaned_data.get('email')
        email = EmailMessage(
            mail_subject, message, to=[to_email]
        )
        email.send()

        messages.success(self.request, mark_safe("Please confirm your email address to complete the registration. Check your inbox and spam folder."))
        return redirect('login')

def activate(request, uidb64, token):
    try:
        uid = urlsafe_base64_decode(uidb64).decode()
        User = apps.get_model('accounts', 'CustomUser')
        user = User._default_manager.get(pk=uid)
    except (TypeError, ValueError, OverflowError, User.DoesNotExist):
        user = None

    if user is not None and default_token_generator.check_token(user, token):
        user.is_active = True
        user.email_verified = True # Assuming a new field `email_verified` in CustomUser
        user.save()
        try:
            db = get_db()
            db.users.update_one(
                {"username": user.username},
                {"$set": {"email_verified": True}}
            )
        except Exception as e:
            messages.warning(request, f"Email verified, but failed to update in MongoDB: {e}")
        messages.success(request, 'Thank you for your email confirmation. Now you can log in to your account.')
        return redirect('login')
    else:
        messages.error(request, 'Activation link is invalid!')
        return redirect('login')
