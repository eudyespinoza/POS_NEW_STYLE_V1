# core/urls.py
from django.urls import path
from . import views
from payments import views as payment_views

app_name = "core"

urlpatterns = [
    path('', views.root, name='home'),
    path('productos/', views.productos, name='productos'),
    path('pos-retail/', views.pos_retail, name='pos_retail'),
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
    path('api/save_local_quotation', views.api_save_local_quotation, name='api_save_local_quotation'),
    path('api/facturar', views.api_facturar, name='api_facturar'),

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

    # Simulador (V5-like) interno
    path('api/simulador/masters', views.api_sim_masters, name='api_sim_masters'),
    path('api/simulador/plans', views.api_sim_plans, name='api_sim_plans'),
    path('api/simulador/discounts', views.api_sim_discounts, name='api_sim_discounts'),
    path('api/simulador/simulate', views.api_simulate, name='api_simulate'),

    path('config/secuencias/', views.secuencias_list, name='secuencias_list'),
    path('config/secuencias/nueva/', views.secuencias_create, name='secuencias_create'),
    path('config/secuencias/<int:pk>/editar/', views.secuencias_update, name='secuencias_update'),
    path('config/secuencias/<int:pk>/eliminar/', views.secuencias_delete, name='secuencias_delete'),

    # Configuración ARCA
    path('config/arca/tipos-contribuyente/', views.tipos_contribuyente_list, name='tipos_contribuyente_list'),
    path('config/arca/tipos-contribuyente/nuevo/', views.tipos_contribuyente_create, name='tipos_contribuyente_create'),
    path('config/arca/tipos-contribuyente/<int:pk>/editar/', views.tipos_contribuyente_update, name='tipos_contribuyente_update'),
    path('config/arca/tipos-contribuyente/<int:pk>/eliminar/', views.tipos_contribuyente_delete, name='tipos_contribuyente_delete'),

    # Configuración - Modos de entrega
    path('config/modos-entrega/', views.modo_entrega_list, name='modo_entrega_list'),
    path('config/modos-entrega/nuevo/', views.modo_entrega_create, name='modo_entrega_create'),
    path('config/modos-entrega/<int:pk>/editar/', views.modo_entrega_update, name='modo_entrega_update'),
    path('config/modos-entrega/<int:pk>/eliminar/', views.modo_entrega_delete, name='modo_entrega_delete'),

    path('payments/simulator/', payment_views.simulator_page, name='payment_simulator'),
    path('payments/config/', payment_views.config_index, name='payments_config'),

    # Simulador V5-like UI + rutas compatibles (tal cual proyecto externo)
    path('maestros/simulador/', views.simulador_v5_ui, name='simulador_v5_ui'),
    path('maestros/simulador/api/masters', views.api_sim_masters, name='sim_v5_masters'),
    path('maestros/simulador/api/plans', views.api_sim_plans, name='sim_v5_plans'),
    path('maestros/simulador/api/discounts', views.api_sim_discounts, name='sim_v5_discounts'),
    path('maestros/simulador/api/simulate', views.api_simulate, name='sim_v5_simulate'),

    # Configuración pagos: Bancos (demo CRUD)
    path('config/pagos/bancos/', views.config_bancos_list, name='config_bancos_list'),
    path('config/pagos/bancos/nuevo/', views.config_banco_form, name='config_banco_create'),
    path('config/pagos/bancos/<str:pk>/editar/', views.config_banco_form, name='config_banco_update'),
    path('config/pagos/bancos/<str:pk>/toggle/', views.config_banco_toggle, name='config_banco_toggle'),
    path('config/pagos/bancos/<str:pk>/eliminar/', views.config_banco_delete, name='config_banco_delete'),
    path('config/pagos/bancos/exportar/', views.config_bancos_export, name='config_bancos_export'),
    path('config/pagos/bancos/importar/', views.config_bancos_import, name='config_bancos_import'),

    path('config/pagos/metodos/', views.config_metodos_list, name='config_metodos_list'),
    path('config/pagos/metodos/nuevo/', views.config_metodo_form, name='config_metodo_create'),
    path('config/pagos/metodos/<str:pk>/editar/', views.config_metodo_form, name='config_metodo_update'),
    path('config/pagos/metodos/<str:pk>/toggle/', views.config_metodo_toggle, name='config_metodo_toggle'),
    path('config/pagos/metodos/<str:pk>/eliminar/', views.config_metodo_delete, name='config_metodo_delete'),
    path('config/pagos/metodos/exportar/', views.config_metodos_export, name='config_metodos_export'),
    path('config/pagos/metodos/importar/', views.config_metodos_import, name='config_metodos_import'),

    path('config/pagos/adquirentes/', views.config_acquirers_list, name='config_acquirers_list'),
    path('config/pagos/adquirentes/nuevo/', views.config_acquirer_form, name='config_acquirer_create'),
    path('config/pagos/adquirentes/<str:pk>/editar/', views.config_acquirer_form, name='config_acquirer_update'),
    path('config/pagos/adquirentes/<str:pk>/toggle/', views.config_acquirer_toggle, name='config_acquirer_toggle'),
    path('config/pagos/adquirentes/<str:pk>/eliminar/', views.config_acquirer_delete, name='config_acquirer_delete'),

    path('config/pagos/tarjetas/', views.config_cards_list, name='config_cards_list'),
    path('config/pagos/tarjetas/nuevo/', views.config_card_form, name='config_card_create'),
    path('config/pagos/tarjetas/<str:pk>/editar/', views.config_card_form, name='config_card_update'),
    path('config/pagos/tarjetas/<str:pk>/toggle/', views.config_card_toggle, name='config_card_toggle'),
    path('config/pagos/tarjetas/<str:pk>/eliminar/', views.config_card_delete, name='config_card_delete'),

    path('config/pagos/descuentos/', views.config_discounts_list, name='config_discounts_list'),
    path('config/pagos/descuentos/nuevo/', views.config_discount_form, name='config_discount_create'),
    path('config/pagos/descuentos/<str:pk>/editar/', views.config_discount_form, name='config_discount_update'),
    path('config/pagos/descuentos/<str:pk>/toggle/', views.config_discount_toggle, name='config_discount_toggle'),
    path('config/pagos/descuentos/<str:pk>/eliminar/', views.config_discount_delete, name='config_discount_delete'),

    path('config/pagos/planes/', views.config_plans_list, name='config_plans_list'),
    path('config/pagos/planes/nuevo/', views.config_plan_form, name='config_plan_create'),
    path('config/pagos/planes/<str:pk>/editar/', views.config_plan_form, name='config_plan_update'),
    path('config/pagos/planes/<str:pk>/toggle/', views.config_plan_toggle, name='config_plan_toggle'),
    path('config/pagos/planes/<str:pk>/eliminar/', views.config_plan_delete, name='config_plan_delete'),
    path('config/pagos/planes/<str:plan_id>/tasas/', views.config_plan_rates, name='config_plan_rates'),
    path('config/pagos/planes/<str:plan_id>/tasas/nueva/', views.config_plan_rate_form, name='config_plan_rate_create'),
    path('config/pagos/planes/<str:plan_id>/tasas/<str:rate_id>/editar/', views.config_plan_rate_form, name='config_plan_rate_update'),
    path('config/pagos/planes/<str:plan_id>/tasas/<str:rate_id>/eliminar/', views.config_plan_rate_delete, name='config_plan_rate_delete'),
]
