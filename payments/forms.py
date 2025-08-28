from django import forms
from .models import PaymentMethod, CardBrand, CreditPlan


class PaymentMethodForm(forms.ModelForm):
    class Meta:
        model = PaymentMethod
        fields = ["code", "label", "enabled", "sort_order"]


class CardBrandForm(forms.ModelForm):
    class Meta:
        model = CardBrand
        fields = ["name", "enabled"]


class CreditPlanForm(forms.ModelForm):
    class Meta:
        model = CreditPlan
        fields = [
            "brand",
            "installments",
            "coef_total",
            "coef_cuota",
            "enabled",
            "valid_from",
            "valid_to",
        ]
