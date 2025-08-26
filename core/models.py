from django.db import models

class TipoContribuyente(models.Model):
    nombre = models.CharField(max_length=100)
    codigo_arca = models.CharField(max_length=10, unique=True)

    class Meta:
        verbose_name = "Tipo de contribuyente"
        verbose_name_plural = "Tipos de contribuyente"

    def __str__(self):
        return f"{self.nombre} ({self.codigo_arca})"

class ModoEntrega(models.Model):
    nombre = models.CharField(max_length=100, unique=True)

    class Meta:
        verbose_name = "Modo de entrega"
        verbose_name_plural = "Modos de entrega"

    def __str__(self):
        return self.nombre

class Rol(models.Model):
    empleado_id = models.IntegerField()
    rol = models.CharField(max_length=100)

    class Meta:
        verbose_name = "Rol"
        verbose_name_plural = "Roles"

    def __str__(self):
        return f"{self.empleado_id} - {self.rol}"
