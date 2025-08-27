from django.urls import path
from . import views

urlpatterns = [
    path('', views.home, name='home'),
    path('notifications/', views.notifications, name='notifications'),
    path('room/<str:username>/', views.room_with_user, name='room_with_user'),
    path('call/<str:username>/', views.room_with_user, name='call_user'),  # legacy alias
    path('subscribe_push/', views.subscribe_push, name='subscribe_push'),
]
