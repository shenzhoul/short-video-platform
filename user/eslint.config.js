const typescript = require('@typescript-eslint/eslint-plugin');
const typescriptParser = require('@typescript-eslint/parser');
const react = require('eslint-plugin-react');
const reactHooks = require('eslint-plugin-react-hooks');
const simpleImportSort = require('eslint-plugin-simple-import-sort');
// const importPlugin = require('eslint-plugin-import');

module.exports = [
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: {
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        console: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',

        // Web APIs
        File: 'readonly',
        FileReader: 'readonly',
        FormData: 'readonly',
        XMLHttpRequest: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Blob: 'readonly',

        // Media APIs
        MediaStream: 'readonly',
        MediaStreamConstraints: 'readonly',
        MediaTrackConstraints: 'readonly',
        HTMLVideoElement: 'readonly',
        HTMLImageElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLDivElement: 'readonly',

        // WebRTC
        RTCIceServer: 'readonly',

        // Intersection Observer
        IntersectionObserver: 'readonly',
        IntersectionObserverEntry: 'readonly',

        // Node.js globals
        process: 'readonly',
        NodeJS: 'readonly',

        // React
        React: 'readonly',

        // Next.js
        Response: 'readonly'
      }
    },
    plugins: {
      '@typescript-eslint': typescript,
      'react': react,
      'react-hooks': reactHooks,
      'simple-import-sort': simpleImportSort
      // 'import': importPlugin
    },
    rules: {
      // TypeScript specific rules
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-empty-function': 'off',

      // React rules
      'react/react-in-jsx-scope': 'off', // Not needed in Next.js
      'react/jsx-filename-extension': [1, {
        'extensions': ['.jsx', '.tsx']
      }],
      'react/jsx-props-no-spreading': 'off',
      'react/prop-types': 'off', // Using TypeScript for prop validation
      'react/require-default-props': 'off', // Not needed with TypeScript

      // React Performance Rules
      'react/jsx-no-bind': ['warn', {
        'allowArrowFunctions': true,
        'allowBind': false,
        'allowFunctions': false
      }],
      'react/jsx-no-leaked-render': 'error', // Prevent leaked renders
      'react/jsx-no-useless-fragment': 'error', // Remove unnecessary fragments
      'react/no-array-index-key': 'warn', // Avoid array index as key
      'react/no-unstable-nested-components': 'error', // Prevent component definitions inside other components

      // React Best Practices
      'react/jsx-boolean-value': ['error', 'never'], // Prefer shorthand boolean props
      'react/jsx-curly-brace-presence': ['error', { 'props': 'never', 'children': 'never' }], // Remove unnecessary curly braces
      'react/jsx-fragments': ['error', 'syntax'], // Use short syntax for fragments
      'react/jsx-no-duplicate-props': 'error', // No duplicate props
      'react/jsx-no-undef': 'error', // No undefined components
      'react/jsx-pascal-case': 'error', // Components should be PascalCase
      'react/jsx-uses-react': 'off', // Not needed in React 17+
      'react/jsx-uses-vars': 'error', // Prevent variables used in JSX to be marked as unused
      'react/no-children-prop': 'error', // Prevent passing children as props
      'react/no-danger-with-children': 'error', // Prevent dangerouslySetInnerHTML with children
      'react/no-deprecated': 'error', // Prevent usage of deprecated methods
      'react/no-direct-mutation-state': 'error', // Prevent direct state mutation
      'react/no-find-dom-node': 'error', // Prevent usage of findDOMNode
      'react/no-is-mounted': 'error', // Prevent usage of isMounted
      'react/no-render-return-value': 'error', // Prevent usage of the return value of ReactDOM.render
      'react/no-string-refs': 'error', // Prevent using string references
      'react/no-unescaped-entities': 'error', // Prevent unescaped entities in JSX
      'react/no-unknown-property': 'error', // Prevent usage of unknown DOM property
      'react/self-closing-comp': 'error', // Prevent extra closing tags for components without children

      // React JSX Formatting
      'react/jsx-closing-bracket-location': 'error', // Validate closing bracket location in JSX
      'react/jsx-closing-tag-location': 'error', // Validate closing tag location for multiline JSX
      'react/jsx-equals-spacing': ['error', 'never'], // No spaces around equal signs in JSX attributes
      'react/jsx-first-prop-new-line': ['error', 'multiline-multiprop'], // First prop on new line for multiline
      'react/jsx-indent': ['error', 2], // Validate JSX indentation
      'react/jsx-indent-props': ['error', 2], // Validate props indentation in JSX
      'react/jsx-max-props-per-line': ['error', { 'maximum': 1, 'when': 'multiline' }], // Limit props per line
      'react/jsx-tag-spacing': ['error', {
        'closingSlash': 'never',
        'beforeSelfClosing': 'always',
        'afterOpening': 'never',
        'beforeClosing': 'never'
      }], // Validate spacing before closing bracket in JSX
      'react/jsx-wrap-multilines': ['error', {
        'declaration': 'parens-new-line',
        'assignment': 'parens-new-line',
        'return': 'parens-new-line',
        'arrow': 'parens-new-line',
        'condition': 'parens-new-line',
        'logical': 'parens-new-line',
        'prop': 'parens-new-line'
      }], // Prevent missing parentheses around multilines JSX

      // React Hooks rules
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // General rules
      'no-unused-vars': 'off', // Use TypeScript version instead
      'no-console': 'warn', // Keep console warnings
      'prefer-const': 'error',
      'no-var': 'error',

      // Style rules
      'comma-dangle': ['error', 'never'],
      'semi': ['error', 'always'],
      'quotes': ['error', 'single'],
      'indent': 'off', // Disabled due to stack overflow issues with complex React/TS files
      'max-len': 'off',
      'no-useless-catch': 'off',

      // Spacing and formatting rules
      'no-multi-spaces': 'error', // Remove double spaces
      'no-multiple-empty-lines': ['error', { max: 1, maxEOF: 0, maxBOF: 0 }], // Max 1 empty line
      'no-trailing-spaces': 'error', // Remove trailing whitespace
      'space-before-blocks': 'error', // Space before blocks
      'space-in-parens': ['error', 'never'], // No spaces in parentheses
      'object-curly-spacing': ['error', 'always'], // Spaces in object literals
      'array-bracket-spacing': ['error', 'never'], // No spaces in array brackets
      'comma-spacing': ['error', { before: false, after: true }], // Space after commas
      'key-spacing': ['error', { beforeColon: false, afterColon: true }], // Space after colons in objects
      'keyword-spacing': 'error', // Space around keywords
      'space-before-function-paren': ['error', { anonymous: 'always', named: 'never', asyncArrow: 'always' }],
      'space-infix-ops': 'error', // Space around operators
      'space-unary-ops': ['error', { words: true, nonwords: false }], // Space around unary operators
      'spaced-comment': ['error', 'always'], // Space at start of comments
      'eol-last': ['error', 'always'], // Newline at end of file
      'no-irregular-whitespace': 'error', // No irregular whitespace
      'block-spacing': 'error', // Space inside single-line blocks
      'brace-style': ['error', '1tbs'], // One true brace style
      'func-call-spacing': ['error', 'never'], // No space between function name and parentheses
      'computed-property-spacing': ['error', 'never'], // No spaces in computed properties
      'arrow-spacing': 'error', // Space around arrow functions
      'template-curly-spacing': ['error', 'never'], // No spaces in template literals
      'rest-spread-spacing': ['error', 'never'], // No space after rest/spread operator
      'semi-spacing': ['error', { before: false, after: true }], // Space after semicolons
      'switch-colon-spacing': 'error', // Space after switch colons
      'no-whitespace-before-property': 'error', // No whitespace before properties

      // Import rules
      // 'import/no-unresolved': 'off',
      // 'import/extensions': [
      //   'error',
      //   'ignorePackages',
      //   {
      //     'js': 'never',
      //     'jsx': 'never',
      //     'ts': 'never',
      //     'tsx': 'never',
      //     '': 'never'
      //   }
      // ],
      // 'import/prefer-default-export': 'off',
      // 'import/no-extraneous-dependencies': ['error', {'devDependencies': true}],
      // 'import/order': 'off',

      // Import sorting
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',

      // Member ordering for React components and TypeScript classes
      '@typescript-eslint/member-ordering': [
        'error',
        {
          'default': [
            'signature',
            'public-static-field',
            'protected-static-field',
            'private-static-field',
            'public-decorated-field',
            'protected-decorated-field',
            'private-decorated-field',
            'public-instance-field',
            'protected-instance-field',
            'private-instance-field',
            'public-abstract-field',
            'protected-abstract-field',
            'static-field',
            'instance-field',
            'abstract-field',
            'decorated-field',
            'field',
            'static-initialization',
            'constructor',
            'public-static-get',
            'protected-static-get',
            'private-static-get',
            'public-decorated-get',
            'protected-decorated-get',
            'private-decorated-get',
            'public-instance-get',
            'protected-instance-get',
            'private-instance-get',
            'public-abstract-get',
            'protected-abstract-get',
            'static-get',
            'instance-get',
            'abstract-get',
            'decorated-get',
            'get',
            'public-static-set',
            'protected-static-set',
            'private-static-set',
            'public-decorated-set',
            'protected-decorated-set',
            'private-decorated-set',
            'public-instance-set',
            'protected-instance-set',
            'private-instance-set',
            'public-abstract-set',
            'protected-abstract-set',
            'static-set',
            'instance-set',
            'abstract-set',
            'decorated-set',
            'set',
            'public-static-method',
            'protected-static-method',
            'private-static-method',
            'public-decorated-method',
            'protected-decorated-method',
            'private-decorated-method',
            'public-instance-method',
            'protected-instance-method',
            'private-instance-method',
            'public-abstract-method',
            'protected-abstract-method',
            'static-method',
            'instance-method',
            'abstract-method',
            'decorated-method',
            'method'
          ]
        }
      ],

      // Other important rules
      'no-use-before-define': 'off',
      '@typescript-eslint/no-use-before-define': 'error',
      'no-shadow': 'off',
      'no-underscore-dangle': 'off',
      'no-undef': 'off', // TypeScript handles this
      'no-redeclare': 'off',
      'no-empty': 'warn',
      // 'no-useless-catch': 'warn',
      'no-case-declarations': 'warn'
    },
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    ignores: [
      'public/*',
      'static/*',
      'dist/*',
      '.next/*',
      'node_modules/*',
      '**/*.d.ts',
      '**/*.test.ts',
      '**/*.spec.tsx',
      '**/*.test.tsx',
      '**/__tests__/**'
    ]
  }
];
