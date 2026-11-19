"""Extract marketplace Excel exports into normalized sales lines."""
import json
import sys
from pathlib import Path
import openpyxl

def clean(value): return "" if value is None else str(value).strip()
def number(value):
    try: return float(value or 0)
    except (TypeError, ValueError): return 0
def get(row, *names):
    for name in names:
        if row.get(name) not in (None, ""): return row[name]
    return ""
def source_for(headers, sheet):
    if "Order ID" in headers: return "TikTok"
    if "No. Pesanan" in headers: return "Shopee"
    if "orderItemId" in headers or "orderNumber" in headers: return "Lazada"
    return sheet
def joined(*values):
    """Keep the marketplace's return marker when it is separate from its status."""
    return " | ".join(clean(value) for value in values if clean(value))
def normalize(row, source):
    if source == "Shopee":
        return {"source":source,"store":clean(get(row,"Toko")),"courier":clean(get(row,"Opsi Pengiriman")),"order_id":clean(get(row,"No. Pesanan")),"status":clean(get(row,"Status Pesanan")),"substatus":clean(get(row,"Status Pembatalan/ Pengembalian")),"cancel_reason":clean(get(row,"Alasan Pembatalan")),"tracking":clean(get(row,"No. Resi")),"delivered":clean(get(row,"Waktu Pengiriman Diatur")),"order_date":clean(get(row,"Waktu Pesanan Dibuat","Waktu Pembayaran Dilakukan")),"sku":clean(get(row,"SKU Induk","Nomor Referensi SKU")),"product_name":clean(get(row,"Nama Produk","Nama Variasi")),"quantity":number(get(row,"Jumlah","Jumlah Produk di Pesan")),"returned_qty":number(get(row,"Returned quantity")),"refund_amount":0,"province":clean(get(row,"Provinsi")),"city":clean(get(row,"Kota/Kabupaten"))}
    if source == "TikTok":
        return {"source":source,"store":clean(get(row,"Nama Toko")),"courier":clean(get(row,"Shipping Provider Name","Delivery Option")),"order_id":clean(get(row,"Order ID")),"status":clean(get(row,"Order Status")),"substatus":joined(get(row,"Order Substatus"),get(row,"Cancelation/Return Type")),"cancel_reason":clean(get(row,"Cancel Reason")),"tracking":clean(get(row,"Tracking ID")),"delivered":clean(get(row,"Shipped Time")),"order_date":clean(get(row,"Order Created Time","Created Time","Create Time","Paid Time")),"sku":clean(get(row,"Seller SKU","SKU ID")),"product_name":clean(get(row,"Product Name","Variation")),"quantity":number(get(row,"Quantity")),"returned_qty":number(get(row,"Sku Quantity of return")),"refund_amount":number(get(row,"Order Refund Amount")),"province":clean(get(row,"Province")),"city":clean(get(row,"Regency and City"))}
    return {"source":source,"store":clean(get(row,"Toko")),"courier":clean(get(row,"shippingProvider","cdShippingProvider")),"order_id":clean(get(row,"orderNumber","orderItemId")),"status":clean(get(row,"status")),"substatus":clean(get(row,"buyerFailedDeliveryReturnInitiator")),"cancel_reason":clean(get(row,"buyerFailedDeliveryReason","buyerFailedDeliveryDetail")),"tracking":clean(get(row,"trackingCode","cdTrackingCode")),"delivered":clean(get(row,"trackingUrl")),"order_date":clean(get(row,"createTime","orderCreatedAt","paidTime")),"sku":clean(get(row,"sellerSku","lazadaSku")),"product_name":clean(get(row,"itemName","variation")),"quantity":1,"returned_qty":1 if number(get(row,"refundAmount")) > 0 else 0,"refund_amount":number(get(row,"refundAmount")),"province":clean(get(row,"shippingRegion")),"city":clean(get(row,"shippingCity"))}

book = openpyxl.load_workbook(Path(sys.argv[1]), read_only=True, data_only=True)
items=[]
for sheet in book.worksheets:
    rows=sheet.iter_rows(values_only=True)
    try: headers=[clean(x) for x in next(rows)]
    except StopIteration: continue
    source=source_for(headers,sheet.title)
    if source not in ("Shopee","TikTok","Lazada"): continue
    for values in rows:
        item=normalize(dict(zip(headers,values)),source)
        if item["order_id"]: items.append(item)
payload = json.dumps({"items":items}, ensure_ascii=False)
if len(sys.argv) > 2:
    Path(sys.argv[2]).write_text(payload, encoding="utf-8")
else:
    print(payload)
