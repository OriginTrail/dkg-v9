# CCL v0.1 Surface Syntax

The package uses canonical YAML for machine evaluation.

This document defines a **human-oriented surface syntax** that can compile into that canonical form.

The surface syntax is intentionally small.

---

## 1. Example

```ccl
policy context_corroboration v0.1.0

rule corroborated(C):
  claim(C)
  count_distinct E where
    supports(E, C)
    evidence_view(E, accepted)
    independent(E)
  >= 2
  exists E where
    supports(E, C)
    evidence_view(E, accepted)
    authority_class(E, vendor)
  not exists C2 where
    contradicts(C2, C)
    accepted_status(C2, accepted)

rule disputed(C):
  claim(C)
  exists C2 where
    contradicts(C2, C)
    accepted_status(C2, accepted)

rule promotable(C):
  corroborated(C)
  claim_epoch(C, E)
  quorum_epoch(incident_review, E)
  quorum_reached(incident_review, 3, 4)

decision propose_accept(C):
  promotable(C)

decision propose_reject(C):
  disputed(C)
```

---

## 2. Design notes

### Variables
- Uppercase identifiers are variables: `C`, `E`
- Lowercase identifiers are predicate names or constants: `claim`, `accepted`, `vendor`

### Rule heads
A rule head defines a derived predicate:

```ccl
rule corroborated(C):
```

### Decisions
A decision head defines a named output that may later feed a normal publish flow:

```ccl
decision propose_accept(C):
```

### Condition blocks
The rule body is conjunction-only in v0.1.
Every listed condition must hold.

### Exists
```ccl
exists E where
  supports(E, C)
  authority_class(E, vendor)
```

### Not exists
```ccl
not exists C2 where
  contradicts(C2, C)
  accepted_status(C2, accepted)
```

### Count distinct
```ccl
count_distinct E where
  supports(E, C)
  independent(E)
>= 2
```

---

## 3. Compilation target

A surface rule compiles into canonical YAML.

Example:

```ccl
rule owner_asserted(C):
  claim(C)
  exists A where
    owner_of(C, A)
    signed_by(C, A)
```

Compiles conceptually to:

```yaml
- name: owner_asserted
  params: [C]
  all:
    - atom: {pred: claim, args: ["$C"]}
    - exists:
        vars: [A]
        where:
          - atom: {pred: owner_of, args: ["$C", "$A"]}
          - atom: {pred: signed_by, args: ["$C", "$A"]}
```

---

## 4. Why canonical YAML exists

A trustless network needs:

- stable hashing
- stable ordering
- simple validation
- easy replay
- low parser ambiguity

So the surface syntax is ergonomics.  
The canonical form is what nodes should actually hash, store, sign, and evaluate.
