from django.db import migrations

def create_initial_data(apps, schema_editor):
    TipoContribuyente = apps.get_model('core', 'TipoContribuyente')
    ModoEntrega = apps.get_model('core', 'ModoEntrega')
    User = apps.get_model('auth', 'User')

    # Initial TipoContribuyente entries
    TipoContribuyente.objects.bulk_create([
        TipoContribuyente(nombre='CF', codigo_arca='96'),
        TipoContribuyente(nombre='RI', codigo_arca='80'),
        TipoContribuyente(nombre='EXE-IVA', codigo_arca='94'),
    ])

    # Initial ModoEntrega entries
    ModoEntrega.objects.bulk_create([
        ModoEntrega(nombre='Ret Suc'),
        ModoEntrega(nombre='Reparto Prg'),
        ModoEntrega(nombre='Ret Dif'),
        ModoEntrega(nombre='Reparto Dif'),
        ModoEntrega(nombre='Acopio'),
    ])

    # Create admin users if they do not exist
    for email in ['edespinoza@familiabercomat.com', 'rortigoza@familiabercomat.com']:
        if not User.objects.filter(username=email).exists():
            User.objects.create_superuser(username=email, email=email, password='changeme123')

class Migration(migrations.Migration):
    dependencies = [
        ('core', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(create_initial_data, migrations.RunPython.noop),
    ]
