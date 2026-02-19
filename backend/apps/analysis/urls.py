from django.urls import path

from apps.analysis import views

app_name = "analysis"

urlpatterns = [
    path("health/", views.health_check, name="health"),
    path("analyze/", views.analyze, name="analyze"),
]
