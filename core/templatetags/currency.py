from django import template

register = template.Library()

@register.filter
def ars(value):
    try:
        value = float(value)
    except (TypeError, ValueError):
        value = 0.0
    return f"$ {value:,.0f}".replace(",", ".")
