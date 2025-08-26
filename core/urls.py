# core/urls.py
from django.urls import path
from . import views

app_name = "core"

urlpatterns = [
    path('', views.root, name='home'),
    path('productos/', views.productos, name='productos'),
    path('simulador/', views.simulador_pagos, name='simulador_pagos'),

    # APIs
    path('api/productos', views.api_productos, name='api_productos'),
    path('api/check_products_update', views.api_check_products_update, name='api_check_products_update'),
    path('api/productos/by_code', views.api_productos_by_code, name='api_productos_by_code'),

    path('producto/atributos/<int:product_id>', views.producto_atributos, name='producto_atributos'),
    path('api/stock/<str:codigo>/<str:store>', views.api_stock, name='api_stock'),

    path('api/update_last_store', views.api_update_last_store, name='api_update_last_store'),
    path('api/datos_tienda/<str:store_id>', views.api_datos_tienda, name='api_datos_tienda'),
    path('api/user_info', views.api_user_info, name='api_user_info'),
    path('api/generate_pdf_quotation_id', views.api_generate_pdf_quotation_id, name='api_generate_pdf_quotation_id'),

    path('api/clientes/create', views.api_clientes_create, name='api_clientes_create'),
    path('api/clientes/search', views.api_clientes_search, name='api_clientes_search'),
    path('api/clientes/validate', views.api_clientes_validate, name='api_clientes_validate'),

    path('api/direcciones/codigo_postal', views.api_direcciones_codigo_postal, name='api_direcciones_codigo_postal'),

    path('api/create_quotation', views.api_create_quotation, name='api_create_quotation'),
    path('api/update_quotation/<str:quotation_id>', views.api_update_quotation, name='api_update_quotation'),

    path('api/local_quotations', views.api_local_quotations, name='api_local_quotations'),
    path('api/local_quotation/<str:quotation_id>', views.api_local_quotation, name='api_local_quotation'),

    path('api/d365_quotation/<str:quotation_id>', views.api_d365_quotation, name='api_d365_quotation'),

    path('api/save_user_cart', views.api_save_user_cart, name='api_save_user_cart'),
    path('api/get_user_cart', views.api_get_user_cart, name='api_get_user_cart'),

    # Configuración ARCA
    path('config/arca/tipos-contribuyente/', views.tipos_contribuyente_list, name='tipos_contribuyente_list'),
    path('config/arca/tipos-contribuyente/nuevo/', views.tipos_contribuyente_create, name='tipos_contribuyente_create'),
    path('config/arca/tipos-contribuyente/<int:pk>/editar/', views.tipos_contribuyente_update, name='tipos_contribuyente_update'),
    path('config/arca/tipos-contribuyente/<int:pk>/eliminar/', views.tipos_contribuyente_delete, name='tipos_contribuyente_delete'),
]
