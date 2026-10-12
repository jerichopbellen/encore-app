
import EventCard from '../../components/events/EventCard'
import events from '../../data/events'

function EventList() {
  return (
    <div className="catalogue">
      <section className="catalogue__intro">
        <p className="eyebrow">MAKE TONIGHT A STORY</p>
        <h1>Find your next<br /><span>encore.</span></h1>
        <p className="catalogue__subtitle">Live music, big games, and the moments you’ll talk about tomorrow.</p>
      </section>
      <section className="catalogue__events" aria-label="Upcoming events">
        <div className="catalogue__heading">
          <div><p className="eyebrow">THE LINEUP</p><h2>Upcoming events</h2></div>
          <span>{events.length} events</span>
        </div>
        <div className="event-grid">
          {events.map((event) => <EventCard key={event.id} event={event} />)}
        </div>
      </section>
    </div>
  )
}

export default EventList
