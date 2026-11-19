import json, sys
from datetime import date, datetime
import openpyxl

def key(x): return ''.join(c.lower() for c in str(x or '') if c.isalnum())
def text(x): return str(x or '').strip()
def day(x):
    if isinstance(x,(date,datetime)): return x.strftime('%Y-%m-%d')
    return ''
def number(x):
    try: return float(x or 0)
    except: return 0
def main(src,out):
 w=openpyxl.load_workbook(src,data_only=True,read_only=True); rows=[]; seen=set()
 for s in w.worksheets:
  data=list(s.iter_rows(values_only=True)); hi=next((i for i,r in enumerate(data) if ('tgl' in [key(x) for x in r] or 'tanggal' in [key(x) for x in r]) and 'barang' in [key(x) for x in r]),None)
  if hi is None: continue
  h={key(x):i for i,x in enumerate(data[hi]) if key(x)}
  get=lambda r,*names: next((r[h[n]] for n in names if n in h and h[n]<len(r)), '')
  last={}
  for r in data[hi+1:]:
   product=text(get(r,'barang'))
   if not product: continue
   for f,names in [('date',('tgl','tanggal')),('store',('toko',)),('city',('kota',)),('sales',('sales',)),('nota',('nota',))]:
    v=get(r,*names)
    if text(v): last[f]=day(v) if f=='date' else text(v)
   if not last.get('date') or not last.get('store'): continue
   qty=number(get(r,'qty')); price=number(get(r,'harga')); k=(last['date'],last['store'],last.get('nota',''),product,qty,price)
   if k in seen: continue
   seen.add(k); rows.append({'invoice_date':last['date'],'due_date':last['date'],'invoice_number':last.get('nota',''),'store_name':last['store'],'city':last.get('city',''),'sales_name':last.get('sales',''),'item_name':product,'quantity':qty,'unit_price':price,'notes':text(get(r,'keterangan','ketarangan'))})
 json.dump({'rows':rows},open(out,'w',encoding='utf8'),ensure_ascii=False)
if __name__=='__main__': main(sys.argv[1],sys.argv[2])
