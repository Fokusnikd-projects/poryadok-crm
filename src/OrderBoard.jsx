import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, closestCorners, pointerWithin, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, DotsThree, PencilSimple, Check, WarningCircle, Clock } from '@phosphor-icons/react';
import { deadlineState } from './board-model.js';

const orderKey = id => `order:${id}`;
const shortDate = date => new Date(date + 'T12:00:00').toLocaleDateString('ru-RU', { day:'numeric', month:'short' });
function CardContents({ order, client, today }) {
  const type = client?.type === 'company' ? 'company' : 'person', deadline = deadlineState(order, today);
  const tomorrow = new Date(today + 'T12:00:00Z'); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const label = order.due === today ? 'Сегодня' : order.due === tomorrow.toISOString().slice(0,10) ? 'Завтра' : order.due ? shortDate(order.due) : 'Без срока';
  return <><span className="order-title" title={order.title}>{order.title}</span><span className="order-meta"><span className="order-client-group"><span className={`client-kind ${type}`} title={type === 'company' ? 'Юридическое лицо' : 'Физическое лицо'} aria-label={type === 'company' ? 'Юридическое лицо' : 'Физическое лицо'}>{type === 'company' ? 'ЮЛ' : 'ФЛ'}</span><span className="order-client" title={client?.name}>{client?.name || 'Без клиента'}</span>{client?.blacklisted && <span className="tag-danger tiny" title={`Чёрный список${client.reason ? ': ' + client.reason : ''}`}>ЧС</span>}</span><span className={`order-deadline ${deadline}`} title={order.completed ? `Завершён${order.completedAt ? ' '+shortDate(order.completedAt) : ''}` : order.due ? `Срок: ${shortDate(order.due)}${deadline === 'overdue' ? ' — просрочен' : ''}` : 'Срок не указан'}>{order.completed ? <><Check size={13}/>Завершён</> : <>{deadline === 'overdue' ? <WarningCircle size={13}/> : deadline === 'soon' ? <Clock size={13}/> : null}<time dateTime={order.due || undefined}>{label}</time></>}</span></span></>;
}
function SortableOrder({ order, client, today, openOrder, clickGuard }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: orderKey(order.id), data: { kind:'order', orderId:order.id, statusId:order.statusId } });
  return <article ref={setNodeRef} className={`order-card client-${client?.type === 'company' ? 'company' : 'person'} ${isDragging ? 'drag-source' : ''}`} style={{ transform: CSS.Transform.toString(transform), transition }} data-order-id={order.id} data-dragging={isDragging || undefined}><button ref={setActivatorNodeRef} {...attributes} {...listeners} className="order-card-main" aria-roledescription="Перемещаемый заказ" aria-label={`Открыть заказ: ${order.title}`} onClick={() => { if (Date.now() >= clickGuard.current) openOrder(order); }}><CardContents order={order} client={client} today={today}/></button></article>;
}
function Column({ status, index, orders, clients, today, target, menu, setMenu, editStatus, openOrder, clickGuard }) {
  const { setNodeRef } = useDroppable({ id:`status:${status.id}`, data:{ kind:'column', statusId:status.id } });
  const active = target?.statusId === status.id;
  return <section ref={setNodeRef} className={`column tone-${index % 3} ${active ? 'drop-target' : ''}`} aria-label={`Статус: ${status.name}`}><header className="column-header"><h3>{status.name}</h3><span>{orders.length}</span><div className="menu-wrap"><button className="icon" aria-label={`Меню статуса ${status.name}`} aria-expanded={menu === status.id} onClick={() => setMenu(menu === status.id ? null : status.id)}><DotsThree size={25} weight="bold"/></button>{menu === status.id && <div className="popover"><button onClick={() => editStatus(status)}><PencilSimple size={19}/>Переименовать или удалить</button></div>}</div></header><SortableContext items={orders.map(o => orderKey(o.id))} strategy={verticalListSortingStrategy}><div className="order-list">{orders.map(order => <React.Fragment key={order.id}>{active && target.orderId === order.id && !target.after && <div className="drop-marker" aria-hidden="true"/>}<SortableOrder order={order} client={clients.find(c => c.id === order.clientId)} today={today} openOrder={openOrder} clickGuard={clickGuard}/>{active && target.orderId === order.id && target.after && <div className="drop-marker" aria-hidden="true"/>}</React.Fragment>)}{active && !target.orderId && <div className="drop-marker" aria-hidden="true"/>}{!orders.length && <div className="column-empty">Перетащите сюда заказ<br/>или <button className="text" onClick={() => openOrder({ statusId:status.id })}>создайте новый</button></div>}</div></SortableContext></section>;
}
function collisions(args) {
  const hits = pointerWithin(args);
  const cards = hits.filter(hit => String(hit.id).startsWith('order:'));
  if (cards.length) return cards;
  if (hits.length) return hits;
  if (args.pointerCoordinates) return [];
  const center = { x:args.collisionRect.left+args.collisionRect.width/2, y:args.collisionRect.top+args.collisionRect.height/2 };
  const column = args.droppableContainers.find(c => { const r=args.droppableRects.get(c.id); return c.data.current?.kind==='column' && r && center.x>=r.left && center.x<=r.right && center.y>=r.top && center.y<=r.bottom; });
  const within = column ? args.droppableContainers.filter(c => c.data.current?.kind==='order' && c.data.current.statusId===column.data.current.statusId) : [];
  return within.length ? closestCorners({...args,droppableContainers:within}) : column ? [{id:column.id}] : closestCorners(args);
}
function keyboardCoordinates(event, { context, currentCoordinates }) {
  const {active,over,droppableContainers,droppableRects}=context;
  if (!active || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.code)) return;
  event.preventDefault();
  const all=droppableContainers.getEnabled(), info=over?.data.current || active.data.current;
  const columns=all.filter(c=>c.data.current?.kind==='column').sort((a,b)=>droppableRects.get(a.id).left-droppableRects.get(b.id).left);
  let index=columns.findIndex(c=>c.data.current.statusId===info.statusId);
  if (event.code==='ArrowRight'||event.code==='ArrowLeft') index=Math.max(0,Math.min(columns.length-1,index+(event.code==='ArrowRight'?1:-1)));
  const column=columns[index];if(!column)return currentCoordinates;
  const cards=all.filter(c=>c.data.current?.kind==='order'&&c.data.current.statusId===column.data.current.statusId).sort((a,b)=>droppableRects.get(a.id).top-droppableRects.get(b.id).top);
  let card=cards[0];
  if(event.code==='ArrowUp'||event.code==='ArrowDown'){const i=cards.findIndex(c=>c.id===(over?.id||active.id));card=cards[Math.max(0,Math.min(cards.length-1,i+(event.code==='ArrowDown'?1:-1)))];}
  const rect=droppableRects.get(card?.id||column.id);
  return {x:rect.left+(card?0:6),y:rect.top+(card?0:44)};
}
export function OrderBoard({ data, today, menu, setMenu, editStatus, openOrder, onMove, showDone = true, setShowDone }) {
  const doneCount = data.orders.filter(o => o.completed).length;
  const visible = showDone ? data.orders : data.orders.filter(o => !o.completed);
  const [activeId, setActiveId] = useState(null), [target, setTarget] = useState(null), [width, setWidth] = useState(308);
  const clickGuard = useRef(0);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint:{ distance:6 } }), useSensor(KeyboardSensor, { coordinateGetter:keyboardCoordinates }));
  const activeOrder = data.orders.find(o => o.id === activeId), activeClient = data.clients.find(c => c.id === activeOrder?.clientId);
  useEffect(() => { document.body.classList.toggle('drag-in-progress', !!activeId); return () => document.body.classList.remove('drag-in-progress'); }, [activeId]);
  function getTarget(event) {
    const info = event.over?.data.current;
    if (!info || info.orderId === activeId) return null;
    const rect = event.active.rect.current.translated, overRect = event.over.rect;
    return { statusId:info.statusId, orderId:info.orderId || null, after:!!info.orderId && !!rect && rect.top + rect.height/2 > overRect.top + overRect.height/2 };
  }
  const track = event => setTarget(getTarget(event));
  return <section className="board-section"><div className="section-heading"><div><h2 className="sr-only">Заказы по статусам</h2><p className="board-legend"><span><span className="client-kind person">ФЛ</span>Физлица</span><span><span className="client-kind company">ЮЛ</span>Юрлица</span></p></div><div className="board-actions">{setShowDone && doneCount > 0 && <label className="check-label toggle-done"><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)}/>Показать завершённые ({doneCount})</label>}<button className="secondary" onClick={() => editStatus()}><Plus size={20}/>Добавить статус</button></div></div><DndContext sensors={sensors} collisionDetection={collisions} accessibility={{ screenReaderInstructions:{ draggable:'Пробел — взять заказ. Стрелки — выбрать место. Пробел — перенести. Escape — отменить.' }, announcements:{ onDragStart:({active})=>`Перемещается заказ ${data.orders.find(o=>orderKey(o.id)===active.id)?.title || ''}`, onDragOver:({over})=>over ? `Колонка ${data.statuses.find(s=>s.id===over.data.current?.statusId)?.name || ''}` : 'Вне доски', onDragEnd:()=> 'Перемещение завершено', onDragCancel:()=> 'Перемещение отменено' } }} onDragStart={event => { setMenu(null); setActiveId(event.active.data.current.orderId); setWidth(event.active.rect.current.initial?.width || 308); }} onDragMove={track} onDragOver={track} onDragCancel={() => { setActiveId(null); setTarget(null); clickGuard.current = Date.now()+200; }} onDragEnd={event => { const destination = getTarget(event); if (destination) onMove(event.active.data.current.orderId, destination.statusId, destination.orderId, destination.after); clickGuard.current = Date.now()+250; setActiveId(null); setTarget(null); }}><div className="board">{data.statuses.map((status,index) => <Column key={status.id} status={status} index={index} orders={visible.filter(o => o.statusId === status.id)} clients={data.clients} today={today} target={target} menu={menu} setMenu={setMenu} editStatus={editStatus} openOrder={openOrder} clickGuard={clickGuard}/>)}</div>{createPortal(<DragOverlay adjustScale={false} dropAnimation={null} zIndex={1000}>{activeOrder ? <article className={`order-card drag-preview client-${activeClient?.type === 'company' ? 'company' : 'person'}`} style={{ width }} data-testid="drag-preview"><div className="order-card-main"><CardContents order={activeOrder} client={activeClient} today={today}/></div><span className="drag-caption">Перемещается</span></article> : null}</DragOverlay>, document.body)}</DndContext></section>;
}
