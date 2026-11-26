import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '@/data/store';
import type { Customer } from '@/data/types';
import { Card, EmptyState, Field, Modal, PageHead, SelectInput, SourceBadge, TextArea, TextInput, Badge } from '@/ui';
import { IconPlus } from '@/ui/icons';

type Draft = {
  id?: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  sourceType: 'REAL' | 'SYNTHETIC' | 'TEST';
};

const empty: Draft = {
  name: '',
  contactName: '',
  email: '',
  phone: '',
  address: '',
  notes: '',
  sourceType: 'REAL',
};

export function Customers() {
  const { state, actions } = useStore();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Draft | null>(null);
  const [error, setError] = useState('');

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return state.customers;
    return state.customers.filter((c) =>
      [c.name, c.contactName, c.email, c.phone, c.address].some((value) => value.toLowerCase().includes(term)),
    );
  }, [state.customers, query]);

  const openNew = () => {
    setError('');
    setEditing({ ...empty });
  };

  const openEdit = (customer: Customer) => {
    setError('');
    setEditing({
      id: customer.id,
      name: customer.name,
      contactName: customer.contactName,
      email: customer.email,
      phone: customer.phone,
      address: customer.address,
      notes: customer.notes,
      sourceType: customer.sourceType,
    });
  };

  const save = () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      setError('A customer name is required.');
      return;
    }
    actions.saveCustomer(editing);
    setEditing(null);
  };

  return (
    <>
      <PageHead
        eyebrow="Operations"
        title="Customers"
        description="Everyone the business works for. Customer records hold contact details only; all commercial history lives on the job."
        actions={
          <button type="button" className="btn btn-primary" onClick={openNew}>
            <IconPlus size={14} />
            New customer
          </button>
        }
      />

      <Card
        title={`${filtered.length} ${filtered.length === 1 ? 'customer' : 'customers'}`}
        action={
          <input
            className="input"
            placeholder="Search name, contact, address…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={{ maxWidth: 280 }}
            aria-label="Search customers"
          />
        }
        tight
      >
        {filtered.length === 0 ? (
          <EmptyState
            title={state.customers.length === 0 ? 'No customers yet' : 'No matches'}
            description={
              state.customers.length === 0
                ? 'Add the first customer to start creating jobs.'
                : 'Adjust the search to find the customer you are after.'
            }
            action={
              state.customers.length === 0 ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={openNew}>
                  Add customer
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Contact</th>
                  <th>Phone</th>
                  <th>Address</th>
                  <th>Jobs</th>
                  <th>Type</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((customer) => {
                  const jobCount = state.jobs.filter((j) => j.customerId === customer.id).length;
                  return (
                    <tr key={customer.id}>
                      <td>
                        <span className="cell-strong">{customer.name}</span>
                        <span className="cell-sub">{customer.email || 'No email recorded'}</span>
                      </td>
                      <td>{customer.contactName || '—'}</td>
                      <td className="nums">{customer.phone || '—'}</td>
                      <td className="small muted" style={{ maxWidth: 260 }}>
                        {customer.address || '—'}
                      </td>
                      <td>
                        {jobCount > 0 ? (
                          <Link to={`/jobs?customer=${customer.id}`} className="small">
                            {jobCount} job{jobCount === 1 ? '' : 's'}
                          </Link>
                        ) : (
                          <span className="faint small">None</span>
                        )}
                      </td>
                      <td>
                        <SourceBadge source={customer.sourceType} />
                      </td>
                      <td className="actions">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(customer)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            if (confirm(`Remove ${customer.name}? Jobs already created keep their record.`)) {
                              actions.deleteCustomer(customer.id);
                            }
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={editing !== null}
        title={editing?.id ? 'Edit customer' : 'New customer'}
        subtitle="Contact details only. Commercial records are attached to jobs."
        onClose={() => setEditing(null)}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={save}>
              Save customer
            </button>
          </>
        }
      >
        {editing && (
          <div className="grid" style={{ gap: 14 }}>
            <Field label="Customer name" error={error || undefined}>
              <TextInput
                value={editing.name}
                autoFocus
                invalid={Boolean(error)}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="e.g. Hargreaves Constructions"
              />
            </Field>
            <div className="form-row">
              <Field label="Contact name">
                <TextInput value={editing.contactName} onChange={(e) => setEditing({ ...editing, contactName: e.target.value })} />
              </Field>
              <Field label="Phone">
                <TextInput value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
              </Field>
            </div>
            <div className="form-row">
              <Field label="Email">
                <TextInput type="email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
              </Field>
              <Field label="Record type" hint="Synthetic and test records are excluded from real reporting.">
                <SelectInput
                  value={editing.sourceType}
                  onChange={(e) => setEditing({ ...editing, sourceType: e.target.value as Draft['sourceType'] })}
                >
                  <option value="REAL">Real</option>
                  <option value="TEST">Test</option>
                  <option value="SYNTHETIC">Synthetic</option>
                </SelectInput>
              </Field>
            </div>
            <Field label="Billing address">
              <TextInput value={editing.address} onChange={(e) => setEditing({ ...editing, address: e.target.value })} />
            </Field>
            <Field label="Notes">
              <TextArea value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            </Field>
            {editing.sourceType !== 'REAL' && (
              <div className="small faint">
                This record will be tagged <Badge tone="warn">{editing.sourceType}</Badge> throughout the application.
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
