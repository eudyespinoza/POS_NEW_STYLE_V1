from django.contrib import admin
from .models import TipoContribuyente, ModoEntrega, Rol

@admin.register(TipoContribuyente)
class TipoContribuyenteAdmin(admin.ModelAdmin):
    list_display = ("nombre", "codigo_arca")
    search_fields = ("nombre", "codigo_arca")

@admin.register(ModoEntrega)
class ModoEntregaAdmin(admin.ModelAdmin):
    list_display = ("nombre",)
    search_fields = ("nombre",)

@admin.register(Rol)
class RolAdmin(admin.ModelAdmin):
    list_display = ("empleado_id", "rol")
    search_fields = ("empleado_id", "rol")
