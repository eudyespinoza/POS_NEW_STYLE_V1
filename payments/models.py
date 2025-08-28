from decimal import Decimal
from django.db import models
from django.conf import settings


class PaymentMethod(models.Model):
    code = models.CharField(max_length=20, unique=True)
    label = models.CharField(max_length=100)
    enabled = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "code"]
        verbose_name = "Payment method"
        verbose_name_plural = "Payment methods"

    def __str__(self) -> str:
        return self.label


class CardBrand(models.Model):
    name = models.CharField(max_length=100)
    enabled = models.BooleanField(default=True)

    class Meta:
        verbose_name = "Card brand"
        verbose_name_plural = "Card brands"

    def __str__(self) -> str:
        return self.name


class CreditPlan(models.Model):
    brand = models.ForeignKey(CardBrand, on_delete=models.CASCADE)
    installments = models.PositiveIntegerField()
    coef_total = models.DecimalField(max_digits=9, decimal_places=4)
    coef_cuota = models.DecimalField(max_digits=9, decimal_places=4, null=True, blank=True)
    enabled = models.BooleanField(default=True)
    valid_from = models.DateField(null=True, blank=True)
    valid_to = models.DateField(null=True, blank=True)

    class Meta:
        unique_together = ("brand", "installments")
        verbose_name = "Credit plan"
        verbose_name_plural = "Credit plans"

    def __str__(self) -> str:
        return f"{self.brand.name} {self.installments} cuotas"


class PaymentSimulation(models.Model):
    cart_id = models.CharField(max_length=100, blank=True, null=True)
    order_id = models.CharField(max_length=100, blank=True, null=True)
    amount_total = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=10, default="ARS")
    change_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    status = models.CharField(max_length=20, default="draft")

    class Meta:
        verbose_name = "Payment simulation"
        verbose_name_plural = "Payment simulations"

    def __str__(self) -> str:
        return f"Simulation {self.id}"


class PaymentSimulationItem(models.Model):
    simulation = models.ForeignKey(PaymentSimulation, related_name="items", on_delete=models.CASCADE)
    method_code = models.CharField(max_length=20)
    amount_base = models.DecimalField(max_digits=12, decimal_places=2)
    card_brand = models.ForeignKey(CardBrand, on_delete=models.SET_NULL, null=True, blank=True)
    is_credit = models.BooleanField(default=False)
    installments = models.PositiveIntegerField(null=True, blank=True)
    coef_total = models.DecimalField(max_digits=9, decimal_places=4, null=True, blank=True)
    interest_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    amount_final = models.DecimalField(max_digits=12, decimal_places=2)
    reference = models.CharField(max_length=255, blank=True)
    extra_meta = models.JSONField(blank=True, null=True)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "id"]
        verbose_name = "Payment simulation item"
        verbose_name_plural = "Payment simulation items"

    def __str__(self) -> str:
        return f"{self.method_code} - {self.amount_base}"
