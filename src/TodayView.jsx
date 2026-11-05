import React from 'react';
import { Plus, WarningCircle, Clock, CalendarBlank, ArrowRight } from '@phosphor-icons/react';
import { attentionGroups } from './board-model.js';

const shortDate = d => new Date(d + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

function OrderRow({ order, client, tone, money, rest, openOrder }) {
  return <li><button className={`agenda-row ${tone}`} onClick={() => openOrder(order)}>
    <span className="agenda-main"><b>{order.title}</b><span className="muted">{client?.name || 'Без клиента'}</span></span>
    <span className="agenda-side">{rest > 0 && <span className="agenda-money" title="Осталось оплатить">к оплате {money(rest)}</span>}<time dateTime={order.due}>{shortDate(order.due)}</time></span>
  </button></li>;
}

// "Сегодня" answers one question: what needs my attention now? The full board lives in "Заказы".
export function TodayView({ data, today, money, paid, openOrder, addClient, goOrders, goSettings }) {
  const client = id => data.clients.find(c => c.id === id);
  const { overdue, today: dueToday, tomorrow } = attentionGroups(data.orders, today);
  const active = data.orders.filter(o => !o.completed);
  const debt = data.orders.reduce((a, o) => a + Math.max(0, o.cost - paid(o)), 0);

  if (!data.clients.length && !data.orders.length) {
    return <section className="content"><div className="onboarding">
      <h2>С чего начать</h2>
      <ol>
        <li><b>Добавьте клиента</b><span>Человека или организацию — заказ всегда привязан к клиенту.</span></li>
        <li><b>Создайте заказ</b><span>Название, срок и стоимость. Оплаты добавляются в карточке заказа.</span></li>
        <li><b>По желанию — подключите Яндекс Контакты</b><span>Перед синхронизацией вы увидите все изменения и подтвердите их.</span></li>
      </ol>
      <div className="empty-actions"><button className="primary" onClick={addClient}><Plus size={20}/>Добавить клиента</button><button className="secondary" onClick={goSettings}>Подключить Яндекс</button></div>
    </div></section>;
  }

  const groups = [
    { key: 'overdue', title: 'Просрочено', icon: <WarningCircle size={20} weight="fill"/>, rows: overdue },
    { key: 'today', title: 'Сегодня', icon: <Clock size={20} weight="fill"/>, rows: dueToday },
    { key: 'tomorrow', title: 'Завтра', icon: <CalendarBlank size={20} weight="fill"/>, rows: tomorrow },
  ];
  const stats = [
    ['Просрочено', overdue.length, overdue.length ? 'overdue' : ''],
    ['Срок сегодня', dueToday.length, dueToday.length ? 'soon' : ''],
    ['Срок завтра', tomorrow.length, ''],
    ['Заказов в работе', active.length, ''],
    ['Ждём оплат', money(debt), ''],
  ];
  const nothing = !overdue.length && !dueToday.length && !tomorrow.length;

  return <section className="content today">
    <dl className="stats">{stats.map(([label, value, tone]) => <div key={label} className={`stat ${tone}`}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {nothing ? <div className="empty-state compact"><h2>Срочного нет</h2><p>На сегодня и завтра сроков нет, просроченных заказов тоже.</p><button className="secondary" onClick={goOrders}>Открыть все заказы<ArrowRight size={18}/></button></div>
      : groups.filter(g => g.rows.length).map(g => <section key={g.key} className={`agenda ${g.key}`} aria-labelledby={`agenda-${g.key}`}>
        <h2 id={`agenda-${g.key}`}>{g.icon}{g.title}<span className="count">{g.rows.length}</span></h2>
        <ul>{g.rows.map(o => <OrderRow key={o.id} order={o} client={client(o.clientId)} tone={g.key} money={money} rest={o.cost - paid(o)} openOrder={openOrder}/>)}</ul>
      </section>)}
    {!nothing && <button className="text link all-orders" onClick={goOrders}>Все заказы по статусам<ArrowRight size={16}/></button>}
  </section>;
}
