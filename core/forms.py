from django import forms
from .models import TipoContribuyente

class TipoContribuyenteForm(forms.ModelForm):
    class Meta:
        model = TipoContribuyente
        fields = ['nombre', 'codigo_arca']
        widgets = {
            'nombre': forms.TextInput(attrs={'class': 'form-control'}),
            'codigo_arca': forms.TextInput(attrs={'class': 'form-control'}),
        }

    def clean_codigo_arca(self):
        codigo = self.cleaned_data['codigo_arca']
        qs = TipoContribuyente.objects.filter(codigo_arca=codigo)
        if self.instance.pk:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise forms.ValidationError('Este código ya está en uso.')
        return codigo
