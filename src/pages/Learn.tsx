import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Page } from '../components/Page';
import { Card, Empty } from '../components/ui';
import { LESSONS, MODULES, type Block } from '../content/lessons';
import { toolById } from '../content/tools';
import { update, useStore } from '../lib/store';

function Body({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        if ('h' in b) return <h2 key={i}>{b.h}</h2>;
        if ('p' in b) return <p key={i}>{b.p}</p>;
        if ('ul' in b)
          return (
            <ul key={i}>
              {b.ul.map((x, k) => (
                <li key={k}>{x}</li>
              ))}
            </ul>
          );
        if ('formula' in b) return <div className="formula" key={i}>{b.formula}</div>;
        if ('callout' in b) return <div className="callout" key={i}>{b.callout}</div>;
        return (
          <div className="tbl-wrap" key={i}>
            <table>
              <thead>
                <tr>
                  {b.table[0].map((c, k) => (
                    <th key={k}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.table.slice(1).map((row, r) => (
                  <tr key={r}>
                    {row.map((c, k) => (
                      <td key={k}>{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}

function LessonView({ id }: { id: string }) {
  const done = useStore((s) => s.lessonsDone);
  const idx = LESSONS.findIndex((l) => l.id === id);
  const lesson = LESSONS[idx];
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);
  if (!lesson) {
    return (
      <Page title="Lesson not found" crumb="Learn">
        <Card>
          <Empty title="That lesson does not exist">
            <Link className="btn primary" to="/learn">
              Back to the Learning centre
            </Link>
          </Empty>
        </Card>
      </Page>
    );
  }
  const mod = MODULES.find((m) => m.id === lesson.module);
  const prev = LESSONS[idx - 1];
  const next = LESSONS[idx + 1];
  const isDone = done.includes(lesson.id);
  const toggle = () => update((s) => ({ ...s, lessonsDone: isDone ? s.lessonsDone.filter((x) => x !== lesson.id) : [...s.lessonsDone, lesson.id] }));
  return (
    <Page title={lesson.title} crumb={`Learn · ${mod?.title ?? ''}`} lede={`${lesson.summary} About ${lesson.minutes} minutes.`} actions={<Link className="btn sm" to="/learn">All lessons</Link>}>
      <article className="prose">
        <Body blocks={lesson.body} />
      </article>
      {lesson.tools && lesson.tools.length > 0 && (
        <Card title="Try it yourself" className="mt" >
          <div className="chips">
            {lesson.tools.map(toolById).filter((t): t is NonNullable<typeof t> => !!t).map((t) => (
              <Link key={t.id} className="chip on" to={t.path}>
                {t.title} →
              </Link>
            ))}
          </div>
        </Card>
      )}
      <div className="row between mt">
        <button className={'btn' + (isDone ? ' on' : ' primary')} onClick={toggle}>
          {isDone ? '✓ Marked as done' : 'Mark as done'}
        </button>
        <div className="row">
          {prev && (
            <Link className="btn" to={`/learn/${prev.id}`}>
              ← {prev.title}
            </Link>
          )}
          {next && (
            <Link className="btn" to={`/learn/${next.id}`}>
              Next: {next.title} →
            </Link>
          )}
        </div>
      </div>
    </Page>
  );
}

export default function Learn() {
  const { id } = useParams();
  const done = useStore((s) => s.lessonsDone);
  if (id) return <LessonView id={id} />;
  const next = LESSONS.find((l) => !done.includes(l.id));
  return (
    <Page tool="learn" noExplain actions={next ? <Link className="btn primary sm" to={`/learn/${next.id}`}>{done.length ? 'Continue' : 'Start'}: {next.title}</Link> : undefined}>
      <p className="plain mb">
        {LESSONS.length} short lessons in {MODULES.length} parts, written to be read in order. Each one ends with a tool to try. {done.length > 0 ? `You have completed ${done.length}.` : 'Nothing here assumes prior knowledge.'}
      </p>
      <div className="stack">
        {MODULES.map((m, mi) => {
          const lessons = LESSONS.filter((l) => l.module === m.id);
          const n = lessons.filter((l) => done.includes(l.id)).length;
          return (
            <Card key={m.id} title={`${mi + 1}. ${m.title}`} sub={m.blurb} right={<span className={'badge ' + (n === lessons.length ? 'pos' : '')}>{n} / {lessons.length}</span>} flush>
              <table className="tbl">
                <tbody>
                  {lessons.map((l) => (
                    <tr key={l.id}>
                      <td style={{ width: 34 }}>
                        <span className={'badge ' + (done.includes(l.id) ? 'pos' : '')} aria-label={done.includes(l.id) ? 'Done' : 'Not done yet'}>
                          {done.includes(l.id) ? '✓' : '·'}
                        </span>
                      </td>
                      <td>
                        <Link className="strong" to={`/learn/${l.id}`}>
                          {l.title}
                        </Link>
                        <span className="sub" style={{ maxWidth: 'none', whiteSpace: 'normal' }}>{l.summary}</span>
                      </td>
                      <td className="r nowrap muted small">{l.minutes} min</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          );
        })}
      </div>
    </Page>
  );
}
