const express=require('express');
const cors=require('cors');
const fetch=require('node-fetch');
require('dotenv').config();
const app=express();
app.use(express.json());
app.use(cors());
const MERCHANT_ID=process.env.CLOVER_MERCHANT_ID;
const API_TOKEN=process.env.CLOVER_API_TOKEN;
const BASE_URL='https://api.clover.com/v3';
const PORT=process.env.PORT||3000;
const H={'Authorization':`Bearer ${API_TOKEN}`,'Content-Type':'application/json'};
async function clover(method,path,body=null){
  const r=await fetch(`${BASE_URL}/merchants/${MERCHANT_ID}${path}`,{method,headers:H,body:body?JSON.stringify(body):undefined});
  const d=await r.json();
  if(!r.ok)throw new Error(d.message||`Error ${r.status}`);
  return d;
}
app.get('/health',(req,res)=>res.json({status:'ok',restaurant:'Amogham Indian Cuisine',merchant:MERCHANT_ID}));
app.get('/api/menu',async(req,res)=>{
  try{
    const d=await clover('GET','/items?expand=categories&limit=500');
    res.json({success:true,items:(d.elements||[]).map(i=>({id:i.id,name:i.name,price:i.price/100,available:i.available!==false,category:i.categories?.elements?.[0]?.name||'Other'}))});
  }catch(e){res.status(500).json({success:false,error:e.message});}
});
async function getDineInTypeId(){
  try{
    const d=await clover('GET','/order_types');
    const t=(d.elements||[]).find(t=>t.label?.toLowerCase().includes('dine')||t.filterType==='DINING');
    return t?.id||(d.elements||[])[0]?.id;
  }catch{return null;}
}
app.post('/api/order',async(req,res)=>{
  const{tableNumber,items,note,paymentMethod}=req.body;
  if(!items||!items.length)return res.status(400).json({success:false,error:'No items'});
  try{
    const typeId=await getDineInTypeId();
    const order=await clover('POST','/orders',{
      ...(typeId?{orderType:{id:typeId}}:{}),
      note:note||'',
      title:`Table ${tableNumber}`
    });
    const orderId=order.id;
    for(const item of items){
      await clover('POST',`/orders/${orderId}/line_items`,{
        name:item.name,
        price:Math.round(item.price*100),
        unitQty:item.qty*1000
      });
    }
    const total=items.reduce((s,i)=>s+i.price*i.qty,0);
    res.json({success:true,orderId,tableNumber,total:total.toFixed(2),message:`Order placed for Table ${tableNumber}`});
  }catch(e){
    console.error(e);
    res.status(500).json({success:false,error:e.message});
  }
});
app.listen(PORT,()=>console.log(`Amogham server running on port ${PORT}`));
