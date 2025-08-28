import json
from decimal import Decimal, ROUND_HALF_UP
from django.http import JsonResponse, HttpResponseBadRequest
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import csrf_exempt
from django.forms.models import model_to_dict

from .models import (
    PaymentMethod,
    CardBrand,
    CreditPlan,
    PaymentSimulation,
    PaymentSimulationItem,
)


def decimal_round(value: Decimal, places: int = 2) -> Decimal:
    q = Decimal(10) ** -places
    return value.quantize(q, rounding=ROUND_HALF_UP)


@require_http_methods(["GET"])
def get_config(request):
    methods = [
        {
            "code": m.code,
            "label": m.label,
            "enabled": m.enabled,
            "sort": m.sort_order,
        }
        for m in PaymentMethod.objects.all().order_by("sort_order")
    ]
    brands = [
        {"id": b.id, "name": b.name, "enabled": b.enabled}
        for b in CardBrand.objects.all()
    ]
    credit_plans = [
        {
            "id": p.id,
            "brand_id": p.brand_id,
            "installments": p.installments,
            "coef_total": float(p.coef_total),
            "enabled": p.enabled,
        }
        for p in CreditPlan.objects.all()
    ]
    params = {"decimals": 2, "rounding": "half_up", "max_combined_payments": 5}
    return JsonResponse(
        {
            "methods": methods,
            "brands": brands,
            "credit_plans": credit_plans,
            "params": params,
        }
    )


@csrf_exempt
@require_http_methods(["POST"])
def simulate(request):
    try:
        payload = json.loads(request.body.decode("utf-8"))
    except json.JSONDecodeError:
        return HttpResponseBadRequest("Invalid JSON")

    amount_total = Decimal(str(payload.get("amount_total", "0")))
    items = payload.get("items", [])

    breakdown_items = []
    subtotal_base = Decimal("0")
    total_interest = Decimal("0")
    cash_total = Decimal("0")

    for idx, item in enumerate(items):
        method = item.get("method")
        amount_base = Decimal(str(item.get("amount_base", "0")))
        interest = Decimal("0")
        amount_final = amount_base
        entry = {
            "method": method,
            "amount_base": float(amount_base),
            "interest_amount": float(interest),
            "amount_final": float(amount_final),
        }
        if method == "credit":
            brand_id = item.get("brand_id")
            installments = item.get("installments")
            try:
                plan = CreditPlan.objects.get(
                    brand_id=brand_id, installments=installments, enabled=True
                )
            except CreditPlan.DoesNotExist:
                return HttpResponseBadRequest("Invalid credit plan")
            total_financed = decimal_round(amount_base * plan.coef_total)
            interest = total_financed - amount_base
            amount_final = total_financed
            installment_value = decimal_round(total_financed / installments)
            entry.update(
                {
                    "brand_id": brand_id,
                    "installments": installments,
                    "coef_total": float(plan.coef_total),
                    "interest_amount": float(interest),
                    "amount_final": float(amount_final),
                    "installment_value": float(installment_value),
                }
            )
        elif method == "cash":
            cash_total += amount_base
        # other methods currently have no additional logic

        subtotal_base += amount_base
        total_interest += interest
        breakdown_items.append(entry)

    total_to_charge = subtotal_base + total_interest
    remaining = amount_total - subtotal_base
    if remaining < 0:
        remaining = Decimal("0")
    change_amount = Decimal("0")
    if cash_total > amount_total - (subtotal_base - cash_total):
        change_amount = cash_total - (amount_total - (subtotal_base - cash_total))
        remaining = Decimal("0")

    breakdown = {
        "items": breakdown_items,
        "subtotal_base": float(subtotal_base),
        "total_interest": float(total_interest),
        "total_to_charge": float(total_to_charge),
        "change_amount": float(change_amount),
        "remaining": float(remaining),
    }

    return JsonResponse({"ok": True, "breakdown": breakdown, "validation": []})


@csrf_exempt
@require_http_methods(["POST"])
def confirm(request):
    try:
        payload = json.loads(request.body.decode("utf-8"))
    except json.JSONDecodeError:
        return HttpResponseBadRequest("Invalid JSON")

    breakdown = payload.get("breakdown")
    if not breakdown:
        return HttpResponseBadRequest("Missing breakdown")

    simulation = PaymentSimulation.objects.create(
        cart_id=payload.get("cart_id"),
        amount_total=Decimal(str(payload.get("amount_total", "0"))),
        currency=payload.get("currency", "ARS"),
        change_amount=Decimal(str(breakdown.get("change_amount", 0))),
        status="confirmed",
    )

    for idx, item in enumerate(breakdown.get("items", [])):
        PaymentSimulationItem.objects.create(
            simulation=simulation,
            method_code=item.get("method"),
            amount_base=Decimal(str(item.get("amount_base", 0))),
            card_brand_id=item.get("brand_id"),
            is_credit=item.get("method") == "credit",
            installments=item.get("installments"),
            coef_total=item.get("coef_total"),
            interest_amount=Decimal(str(item.get("interest_amount", 0))),
            amount_final=Decimal(str(item.get("amount_final", 0))),
            sort_order=idx,
        )

    return JsonResponse({"ok": True, "simulation_id": simulation.id})


@require_http_methods(["GET"])
def get_simulation(request, pk: int):
    try:
        simulation = PaymentSimulation.objects.get(pk=pk)
    except PaymentSimulation.DoesNotExist:
        return HttpResponseBadRequest("Not found")

    data = model_to_dict(simulation, fields=["id", "cart_id", "order_id", "amount_total", "currency", "change_amount", "status", "created_at"])
    data["items"] = [
        model_to_dict(
            item,
            fields=[
                "method_code",
                "amount_base",
                "interest_amount",
                "amount_final",
                "card_brand_id",
                "installments",
                "coef_total",
            ],
        )
        for item in simulation.items.all().order_by("sort_order")
    ]
    return JsonResponse(data)
