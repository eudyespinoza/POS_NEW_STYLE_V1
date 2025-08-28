from django.urls import path
from . import views

app_name = "payments"

urlpatterns = [
    path("config", views.get_config, name="get_config"),
    path("simulate", views.simulate, name="simulate"),
    path("confirm", views.confirm, name="confirm"),
    path("simulation/<int:pk>", views.get_simulation, name="get_simulation"),
]
