// Optional work-records-v1 structure checks. No IO, execution, authorization, or verdict generation.
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = v => typeof v === 'string' && v.trim().length > 0;
const revision = v => Number.isSafeInteger(v) && v > 0;
const results = ['PASS', 'FAIL', 'NOT_VERIFIED', 'NOT_APPLICABLE'];
const decisions = ['ASSIGN', 'ACCEPT', 'REVISE', 'ANSWER', 'NEED_USER', 'BLOCKED', 'GOAL_COMPLETE'];
export const NOT_CHECKED = Object.freeze([
  'authorization_truth', 'evidence_content_or_accessibility', 'actual_input_or_rule_hashes',
  'artifact_quality', 'reviewer_independence', 'transport_identity_or_pending_operations',
  'full_goal_acceptance_or_safe_closure'
]);
export function checkRecords({contract, delivery, verdict} = {}) {
  const diagnostics = [];
  const add = (code, field, message, severity = 'ERROR') => diagnostics.push({code, field, message, severity});
  const need = (record, key, valid, prefix) => {
    if (!valid(record[key])) add('INVALID_FIELD', `${prefix}.${key}`, 'Required field is missing, empty, or has the wrong type.');
  };
  const strings = (record, keys, prefix) => keys.forEach(k => need(record, k, text, prefix));
  const arrays = (record, keys, prefix) => keys.forEach(k => need(record, k, Array.isArray, prefix));
  const stringList = (record, key, prefix, nonempty = false) => {
    if (!Array.isArray(record[key]) || (nonempty && !record[key].length) || record[key].some(v => !text(v))) {
      add('INVALID_FIELD', `${prefix}.${key}`, 'Expected an array of nonempty strings.');
    }
  };
  const identity = (record, kind) => {
    if (!object(record)) { add('INVALID_RECORD', kind, 'Expected a JSON object.'); return false; }
    if (record.record_type !== kind) add('RECORD_TYPE', `${kind}.record_type`, 'Wrong work record type.');
    strings(record, ['project_id', 'task_id'], kind);
    for (const k of ['goal_revision', 'revision']) need(record, k, revision, kind);
    return true;
  };
  const same = (a, b, key, field) => {
    if (a[key] !== b[key]) add('IDENTITY_MISMATCH', field, 'Record identity or version does not match.');
  };
  const rows = (list, field, key, validate) => {
    const map = new Map();
    if (!Array.isArray(list)) return map;
    list.forEach((row, i) => {
      const prefix = `${field}[${i}]`;
      if (!object(row)) { add('INVALID_ROW', prefix, 'Expected an object entry.'); return; }
      need(row, key, text, prefix);
      if (text(row[key])) {
        if (map.has(row[key])) add('DUPLICATE_ID', `${prefix}.${key}`, 'Duplicate identifier.');
        else map.set(row[key], row);
      }
      validate(row, prefix);
    });
    return map;
  };
  const evidence = (row, prefix) => {
    if (!results.includes(row.result)) add('RESULT_VALUE', `${prefix}.result`, 'Unsupported acceptance result.');
    if (row.result === 'PASS' && !text(row.evidence)) add('MISSING_EVIDENCE', `${prefix}.evidence`, 'PASS requires an evidence reference; content is not inspected.');
    if (row.result === 'NOT_APPLICABLE' && !text(row.reason)) add('MISSING_NA_REASON', `${prefix}.reason`, 'NOT_APPLICABLE requires a scope reason.');
  };
  const cValid = identity(contract, 'contract');
  let criteria = new Map(), inputVersions = new Set();
  if (cValid) {
    strings(contract, ['owner_role', 'authorization_reference', 'goal', 'report_to'], 'contract');
    stringList(contract, 'allowed_actions', 'contract', true);
    for (const k of ['deliverables', 'stop_conditions']) stringList(contract, k, 'contract', true);
    stringList(contract, 'exclusions', 'contract');
    arrays(contract, ['inputs', 'resources', 'dependencies', 'acceptance'], 'contract');
    if (!object(contract.rule_baseline)) add('INVALID_FIELD', 'contract.rule_baseline', 'Expected a rule baseline object.');
    else {
      strings(contract.rule_baseline, ['id'], 'contract.rule_baseline');
      stringList(contract.rule_baseline, 'modules', 'contract.rule_baseline', true);
    }
    if (Array.isArray(contract.inputs)) {
      if (!contract.inputs.length) add('EMPTY_INPUTS', 'contract.inputs', 'At least one input baseline is required in this optional format.');
      const inputs = rows(contract.inputs, 'contract.inputs', 'reference', (row, prefix) => strings(row, ['version'], prefix));
      inputVersions = new Set([...inputs.values()].map(v => v.version).filter(text));
    }
    rows(contract.resources, 'contract.resources', 'reference', (row, prefix) => {
      strings(row, ['writer', 'baseline', 'release_condition'], prefix);
      if (row.writer !== contract.owner_role) add('RESOURCE_OWNER_MISMATCH', `${prefix}.writer`, 'Resource writer differs from contract owner; coordinate the responsibility.');
    });
    criteria = rows(contract.acceptance, 'contract.acceptance', 'id', (row, prefix) => strings(row, ['criterion', 'evidence_required'], prefix));
    if (!criteria.size) add('EMPTY_ACCEPTANCE', 'contract.acceptance', 'At least one observable acceptance condition is required.');
  }
  const hasDelivery = delivery !== undefined;
  const hasVerdict = verdict !== undefined;
  const dValid = hasDelivery && identity(delivery, 'delivery');
  let submitted = new Map();
  if (dValid) {
    strings(delivery, ['owner_role', 'rule_baseline_id', 'submission_request_id', 'artifact_version', 'decision_requested', 'next_suggestion'], 'delivery');
    arrays(delivery, ['results', 'known_failures', 'not_verified', 'pending_operations'], 'delivery');
    if (cValid) {
      for (const k of ['project_id', 'goal_revision', 'task_id', 'revision', 'owner_role']) same(contract, delivery, k, `delivery.${k}`);
      if (object(contract.rule_baseline) && delivery.rule_baseline_id !== contract.rule_baseline.id) add('RULE_BASELINE_MISMATCH', 'delivery.rule_baseline_id', 'Delivery refers to a different rule baseline.');
    }
    submitted = rows(delivery.results, 'delivery.results', 'acceptance_id', (row, prefix) => {
      strings(row, ['input_version', 'method', 'environment', 'observer', 'independence'], prefix);
      evidence(row, prefix);
      if (cValid && !criteria.has(row.acceptance_id)) add('UNKNOWN_ACCEPTANCE', `${prefix}.acceptance_id`, 'Result does not belong to this contract.');
      if (cValid && !inputVersions.has(row.input_version)) add('INPUT_VERSION_MISMATCH', `${prefix}.input_version`, 'Input version is not among the declared contract baselines.');
    });
    if (cValid && [...criteria.keys()].some(k => !submitted.has(k))) add('INCOMPLETE_DELIVERY', 'delivery.results', 'Some contract conditions have no submitted result; acceptance is incomplete.', 'WARNING');
  }
  if (!hasDelivery) add('DELIVERY_NOT_PROVIDED', 'delivery', 'Only the contract structure was checked.', 'WARNING');
  if (hasVerdict && !hasDelivery) add('VERDICT_REQUIRES_DELIVERY', 'verdict', 'A verdict must be checked against its delivery.');
  const vValid = hasVerdict && identity(verdict, 'verdict');
  if (vValid) {
    strings(verdict, ['submission_request_id', 'artifact_version', 'reviewer_role', 'review_method', 'next_action'], 'verdict');
    arrays(verdict, ['review_results', 'limitations'], 'verdict');
    if (!decisions.includes(verdict.decision)) add('DECISION_VALUE', 'verdict.decision', 'Unsupported company decision.');
    if (cValid) for (const k of ['project_id', 'goal_revision', 'task_id', 'revision']) same(contract, verdict, k, `verdict.${k}`);
    if (dValid) {
      for (const k of ['submission_request_id', 'artifact_version']) same(delivery, verdict, k, `verdict.${k}`);
      if (verdict.reviewer_role === delivery.owner_role) add('SELF_REVIEW', 'verdict.reviewer_role', 'Reviewer and implementer roles are the same; independent acceptance is not demonstrated.', 'WARNING');
    }
    const reviewed = rows(verdict.review_results, 'verdict.review_results', 'acceptance_id', (row, prefix) => {
      evidence(row, prefix);
      if (cValid && !criteria.has(row.acceptance_id)) add('UNKNOWN_ACCEPTANCE', `${prefix}.acceptance_id`, 'Review condition does not belong to this contract.');
      if (dValid && !submitted.has(row.acceptance_id)) add('REVIEW_WITHOUT_DELIVERY', `${prefix}.acceptance_id`, 'No submitted result exists for this reviewed condition.');
    });
    if (verdict.next_request_handle !== undefined && verdict.next_request_handle !== null && !text(verdict.next_request_handle)) add('INVALID_FIELD', 'verdict.next_request_handle', 'Expected null or a nonempty handle reference.');
    if (verdict.decision === 'ACCEPT') {
      strings(verdict, ['accepted_scope'], 'verdict');
      if (verdict.accepted_ids === undefined) add('ACCEPT_SCOPE_NOT_STRUCTURED', 'verdict.accepted_ids', 'Natural-language acceptance scope was not interpreted; optional accepted_ids can make item scope checkable.', 'WARNING');
      else {
        stringList(verdict, 'accepted_ids', 'verdict', true);
        if (Array.isArray(verdict.accepted_ids)) {
          if (new Set(verdict.accepted_ids).size !== verdict.accepted_ids.length) add('DUPLICATE_ID', 'verdict.accepted_ids', 'Duplicate accepted condition.');
          for (const id of verdict.accepted_ids) {
            if (!criteria.has(id) || reviewed.get(id)?.result !== 'PASS' || (dValid && submitted.get(id)?.result !== 'PASS')) add('ACCEPTED_ITEM_NOT_PASS', 'verdict.accepted_ids', 'An explicitly accepted item lacks a matching PASS delivery/review.');
          }
        }
      }
    }
    if (verdict.decision === 'GOAL_COMPLETE') add('GOAL_COMPLETE_NOT_PROVEN', 'verdict.decision', 'This static checker cannot verify full goal acceptance or safe closure.', 'WARNING');
  }
  if (!hasVerdict) add('VERDICT_NOT_PROVIDED', 'verdict', 'No reviewer decision was checked.', 'WARNING');
  const ok = !diagnostics.some(d => d.severity === 'ERROR');
  return {format: 'optional-work-records-v1', status: ok ? 'STATIC_CHECK_OK' : 'STATIC_CHECK_ERRORS', ok,
    checked_records: ['contract', ...(hasDelivery ? ['delivery'] : []), ...(hasVerdict ? ['verdict'] : [])],
    diagnostics, not_checked: [...NOT_CHECKED]};
}
