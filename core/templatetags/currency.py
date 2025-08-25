from django import template

register = template.Library()

@register.filter
def ars(value):
    try:
        value = float(value)
    except (TypeError, ValueError):
        value = 0.0
    # Formatea con dos decimales y estilo argentino (separador de miles ".", decimales ",")
    formatted = f"$ {value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return formatted
