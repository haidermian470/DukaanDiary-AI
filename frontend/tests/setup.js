import { configure } from '@testing-library/react'

// Live screens are lazy-loaded; allow time for chunks to load on slower machines.
configure({ asyncUtilTimeout: 5000 })
